const head = document.getElementsByTagName("head")[0];
const importMap = (function() {
    const mapEl = document.querySelector("script[type=importmap]");
    const importMap = mapEl ? JSON.parse(mapEl.innerHTML).imports : {};
    for (const name in importMap) {
        const deps = importMap[name];
        if (!Array.isArray(deps)) {
            importMap[name] = [deps];
        }
    }
    return importMap;
})();

class LoadedDependency {
    name: string;
    module?: any;
    promise: Promise<any>;
    // @ts-ignore
    resolve: (_: any) => void;

    constructor(name: string) {
        this.name = name;
        this.promise = new Promise((resolve, _reject) => this.resolve = resolve);
    }
}

type VariableFunction = (...args: any[]) => any;
const loadedDependencies = new Map<string, LoadedDependency>();
(<any>window).loadedDependencies = loadedDependencies;
// console.log(loadedDependencies, (<any>window).loadedDependencies);
async function innerDefine(name: string, dependencies: string[], callback: VariableFunction, parent?: string): Promise<void> {
    let exportsImported = false;
    const exports = {};
    const loadedDeps = await Promise.all([...dependencies].map(async (dependency) => {
        if (dependency === "exports") {
            exportsImported = true;
            return exports;
        } else if (dependency === "require") {
            return (<any>window).require;
        } else {
            // Handle relative paths, e.g. ./foo/bar requesting ./baz should map to ./foo/baz
            if (dependency.startsWith("./")) {
                const thisPath = name.match(/\//) ? name : importMap[name][0];
                dependency = thisPath.replace(/\/[^/]+$/, dependency.replace("./", "/"));
            }
            return await timed_await(requireAsync(dependency, undefined, name),
                `require of dependency ${dependency} for define of ${name}`);
        }
    }));

    // The module returns itself as the return value of the define callback
    console.log("loadedDeps for " + name, loadedDeps);
    let module = callback(...loadedDeps);
    if (!module && exportsImported) {
        module = exports;
    }
    console.log(`innerDefine looking up loadedDependency ${name}`);
    let dependency = loadedDependencies.get(name);
    if (!dependency) {
        throw new Error("define called but not in response to any require!");
    }
    if (dependency.module) {
        throw new Error("dependency loaded more than once!");
    }
    dependency.module = module;
    dependency.resolve(module);
}

// A define function that is called from within a require context, e.g. where the name is determined
// by the preceding call to require and not by the call to define.
type RequireDefine = ((_1: any, _2: any, _3: any) => Promise<void>) & {
    exports: {};
    amd: boolean;
    called: boolean;
    promise: Promise<void>;
};

function makeDefine(autoName: string, resolve: (resolution: any) => any, parent?: string): RequireDefine {
    const localDefine = async function(_1: any, _2: any, _3: any): Promise<void> {
        define.called = true;
        // ES3 and ES5 don't support accessing `arguments` in an async function
        // let args = Array.from(arguments);
        if (typeof(_3) !== "undefined") {
            var args = [_1, _2, _3];
        } else if (typeof(_2) !== "undefined") {
            var args = [_1, _2];
        } else if (typeof(_1) !== "undefined") {
            var args = [_1];
        } else {
            var args = [];
        }

        if (args.length === 0) {
            console.error("Unknown define mode", args);
            throw new Error("Unknown define mode!");
        }

        let name = autoName;
        if (args.length > 1) {
            if (typeof args[0] === 'string') {
                // Unadvised call to define with a hard-coded name
                console.log(`Instantiating ${autoName} with an explicit name ${args[0]}`);
                name = args.shift();
            }
        }

        // define with three arguments can only be with a fixed name as the first
        if (args.length > 2) {
            console.error("Unknown define mode", args);
            throw new Error("Unknown define mode!");
        }

        let deps = [];
        if (args.length === 2) {
            // The only way we can have two parameters left is if the first is the dependencies
            if (Array.isArray(args[0])) {
                deps = args.shift();
            } else {
                console.error("Unknown define mode", args);
                throw new Error("Unknown define mode");
            }
        }

        if (deps.length > 0) {
            console.log(`${name} requested ${deps}`);
        }

        // Try to resolve paths relative to the current module, e.g. cldr/event depending on ../cldr
        for (let i = 0; i < deps.length; ++i) {
            while (deps[i].startsWith("../")) {
                deps[i] = deps[i].substr(3);
            }
        }

        // Only one parameter left, the module itself
        let callback: VariableFunction;
        if (typeof args[0] === 'function') {
            callback = args[0];
        } else {
            console.log(`Instantiating ${autoName} via simple initialization`);
            callback = () => args[0];
        }

        const module = await timed_await(innerDefine(name, deps, callback, parent), `define after eval of ${name} by ${parent}`);
        // loadedDependencies must contain the newly loaded module before we resolve the promise
        // That is taken care of by `define(..)`
        resolve(module);
        defineResolve(module);
    };
    let defineResolve: (_: any) => void;
    const define = Object.assign(localDefine, {
        exports: {},
        amd: true,
        called: false,
        promise: new Promise<void>((resolve, _reject) => { defineResolve = resolve; }),
    });

    return define;
};

async function timed_await<T>(promise: Promise<T>, name: string) {
    let waited = 0;
    let timer = setInterval(() => {
        waited += 5;
        console.error(`Promise ${name} still not resolved after ${waited} seconds!`);
    }, 5000);
    const result = await promise;
    clearInterval(timer);
    return result;
}

// tsc complains if we define a top-level `require` directly, so rely on `window` contents being directly accessible instead.
(<any>window).require = function(_1: any, _2?: any): any {
    if (arguments.length === 1) {
        if (typeof _1 !== 'string') {
            throw new Error("Unsupported require call!");
        }
        // This is the synchronous version of require() that can only load previously loaded and cached modules
        console.log(`require looking up loadedDependency ${_1}`);
        const dependency = loadedDependencies.get(_1);
        if (dependency && dependency.module) {
            return dependency.module;
        } else {
            console.warn(`${_1} has not been previously loaded asynchronously!
Use \`requireAsync(name, callback?)\` or \`require([name], callback?)\` instead.`);
        }
    }

    // Default asynchronous method
    return requireAsync(_1, _2);
}

const hasExtensionRegex = /\/[^\/]+\./;
export async function requireAsync(names: string|string[], callback?: VariableFunction, parent?: string): Promise<any> {
    // ES3 and ES5 don't support accessing `arguments` in an async function
    console.log("requireAsync called with arguments ", names, callback, parent);

    // If we're being called directly by an external script, the async form takes an array as the first parameter.
    if (Array.isArray(names)) {
        const deps = await Promise.all(names.map(async (dep) =>
            await requireAsync(dep, undefined, parent)));
        if (callback) {
            return callback(...deps);
        }
        return undefined;
    }

    let name = names;
    {
        // This scope is unnecessary but it stops TypeScript from confusing a
        // possibly null/undefined `dependency` with the definitely valid one
        // that we later assign to it.
        console.log(`requireAsync looking up loadedDependency ${name}`);
        let dependency = loadedDependencies.get(name);
        if (dependency) {
            // Another simultaneous asynchronous load has been started
            let module = await timed_await(dependency.promise, `simultaneous load of ${name} for ${parent}`);
            // Internally, require is never called with a callback
            if (callback) {
                throw Error("Unexpected callback");
            }
            console.log(`Fast-loading ${name} from preloaded cache for ${parent}`, module);
            return module;
        }
    }

    if (parent) {
        console.log(`${parent} is loading ${name}`);
    } else {
        console.log(`loading ${name}`);
    }
    const dependency = new LoadedDependency(name);
    loadedDependencies.set(name, dependency);

    let path = name;
    let extraPaths = [];
    if (!name.startsWith("http:") && !name.startsWith("./") && !name.startsWith('/')) {
        const urls = importMap[name];
        if (!urls) {
            throw new Error(`${name} missing from import map!`);
        }
        path = urls[0];
        extraPaths = urls.slice(1);
    }

    // Re-map TypeScript files
    if (path.endsWith(".ts")) {
        path = path.replace(/\.ts$/, ".js");
    }
    // Set a default extension if there is none
    if (!hasExtensionRegex.test(path)) {
        path += ".js";
    }

    console.log(`Loading ${path} as ${name}`);
    const xhr = new XMLHttpRequest();
    const requirePromise = new Promise((resolve, reject) => {
        xhr.onreadystatechange = async function() {
            if (this.readyState == 4 && this.status == 200) {
                const js = xhr.responseText;
                const define = makeDefine(name, resolve, parent);

                // This must be defined; the evaluated JS might use it if it
                // only understands CommonJS
                const exports = define.exports;
                var module = { exports };

                // Prevent warnings about unused `exports` variable:
                Object.assign(exports, {});
                Object.assign(module, {});
                console.log(`importing ${name} via eval`);
                // console.debug(js);
                eval(js);
                console.debug(`finished eval of ${name}`);
                if (define.called) {
                    await timed_await(define.promise, `define.promise for ${name} after define was definitively called!`);
                    const module = dependency!.module;
                    if (!module) {
                        throw new Error("define.promise resolved but module is still null!");
                    }
                    console.log(`loaded ${name} as `, module);
                    return module;
                } else {
                    // global/non-AMD module
                    // if module.exports is overridden by the eval'd code,
                    // exports may no longer point to the same entity.
                    console.log(`${name} is not an AMD module`);
                    resolve(module.exports);
                    dependency.module = module.exports;
                    dependency.resolve(module.exports);
                    console.log(`loaded ${name} as `, module.exports);
                    return module.exports;
                }
            }
        }
        xhr.onerror = reject;
        xhr.open("GET", path);
        xhr.send();
    });

    await timed_await(Promise.all([requirePromise, ...(extraPaths.map(load))]), `overall load of dependency ${name} for ${parent}`);
    // We wait for the resolution which guarantees loadedDependencies contains this self-same module
    {
        // This is in a new scope to prevent pollution of the eval scope above
        const module = await timed_await(dependency.promise,
            `loadedDependency promise for ${name} from ${parent} after requirePromise resolved!`);
        if (callback) {
            callback(module);
        }
        return module;
    }
}

function load(urls: string[] | string): Promise<void | void[]> {
    if ((window as any).loadjs === undefined) {
        (window as any).loadjs = load;
    }

    if (!(urls instanceof Array)) {
        return loadSingle(urls);
    }

    const promises = [];
    for (const url of urls) {
        promises.push(loadSingle(url));
    }

    return Promise.all(promises);
}

async function loadSingle(url: string) {
    let start;
    if (window.console !== undefined) {
        // console.log(`Starting load of ${url}`);
        start = new Date().getTime();
    }

    let promise;
    if (/\.css$/i.test(url)) {
        promise = loadCss(url);
    } else {
        promise = loadjs(url);
    }

    try {
        await promise;

        /* eslint-disable no-console */
        if (start && window.console) {
            const elapsed = (new Date().getTime()) - start;
            console.log(`${url} loaded in ${elapsed}ms`);
        }
        /* eslint-enable no-console */
    } catch (ex) {
        /* eslint-disable no-console */
        if (window.console !== undefined) {
            console.error(`Error loading ${url}: `, ex);
        }
        /* eslint-enable no-console */
        throw ex;
    }
}

interface LegacyHTMLElement extends HTMLElement {
    attachEvent?: (name: string, callback: EventListenerOrEventListenerObject) => void;
}

function loadCss(url: string) {
    function attach(el: LegacyHTMLElement, name: string, callback: EventListenerOrEventListenerObject) {
        if (el.addEventListener !== undefined) {
            el.addEventListener(name, callback);
            return true;
        } else if (el.attachEvent !== undefined) {
            el.attachEvent(`on${name}`, callback);
            return true;
        } else {
            /* eslint-disable no-console */
            if (window.console) {
                console.error(`Error creating ${name} listener!`);
            }
            /* eslint-enable no-console */
            return false;
        }
    }

    return new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = url;

        // Firefox used to supported media="preload" natively, but then explicitly
        // blocked it (so that we can't even use it ourselves).
        link.media = "__preload";
        attach(link, "load", () => {
            // Trigger actually loading the stylesheet. Make sure to prevent recursive
            // invocation, because Firefox will hang and crash.
            // See https://bugzilla.mozilla.org/show_bug.cgi?id=1209124#c34
            if (link.media !== "screen") {
                link.media = "screen";
            }
            resolve();
        });
        attach(link, "error", reject);

        head.appendChild(link);
    });
}

function loadjs(url: string) {
    return new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.async = true;
        script.type = "text/javascript";

        // IE8 and below don't call script.onload, but rather XDomainRequest,
        // which is unavailable on later browsers. XDomainRequest is a lot like
        // XMLHttpRequest but its `readyState` returns a string rather than a
        // number. Inserting the script element into the DOM breaks load
        // detection, so we only do that at the very end.
        if (script.onload === undefined) {
            const s = script as any;
            s.onreadystatechange = () => {
                // A readyState in (complete, completed) indicates success,
                // but readyState == loaded *may* indicate an error.
                if (!s.readyState
                    || s.readyState === "complete"
                    || s.readyState === "completed") {
                    head.appendChild(script);
                    resolve();
                } else if (s.readyState === "loaded") {
                    // Attempting to enumerate the children of the script tag
                    // will result in s.readyState changing to "loading" if
                    // there is an error (yes, it's a hack - but then again, I
                    // don't think IE8 is going to be seeing an updates that
                    // will change this behavior any time soon!)
                    /* eslint-disable */
                    (function(_) { })(script.children);
                    /* eslint-enable */
                    if (s.readyState === "loading") {
                        // The transition from loaded => loading can only happen
                        // if an error was encountered.
                        reject();
                    } else {
                        resolve();
                    }
                }
            };
        } else {
            script.onload = () => resolve();
            script.onerror = reject;
            head.appendChild(script);
        }

        // Only assign this once the handlers are in place
        script.src = url;
    });
}
