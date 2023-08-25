// Copyright (c) Mahmoud Al-Qudsi 2017 - 2023. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

if (!document.head) {
    (<any> document).head = document.getElementsByTagName("head")[0];
}

// Can be extended or overwritten with require.config({ paths: {..} })
const importMap: { [name: string]: [string] } = (function() {
    const mapEl: HTMLScriptElement | null = (function() {
        if (document.querySelector) {
            return document.querySelector("script[type=importmap]");
        } else {
            const scriptTags = document.getElementsByTagName("script");
            for (let i = 0; i < scriptTags.length; ++i) {
                if (scriptTags[i].type === "importmap") {
                    return scriptTags[i];
                }
            }
            return null;
        }
    })();

    let importMap: { [name: string]: [string] } = {};
    if (mapEl) {
        try {
            if (window.JSON && JSON.parse) {
                importMap = JSON.parse(mapEl.text).imports ?? {};
            } else {
                // eslint-disable-next-line no-eval
                importMap = eval(`(${mapEl.text}).imports`) ?? {};
            }
        } catch (ex) {
            // eslint-disable-next-line no-console
            window.console?.error?.("Error parsing import map:", ex);
        }

        // Convert non-array dependencies to arrays
        for (const name in importMap) {
            const deps = importMap[name];
            if (!Array.isArray(deps)) {
                importMap[name] = [deps];
            }
        }
    }

    return importMap;
})();

class LoadedDependency {
    public name: string;
    public module?: unknown;
    public promise: Promise<unknown>;
    public resolve!: (_: unknown) => void;

    public constructor(name: string) {
        this.name = name;
        this.promise = new Promise((resolve, _reject) => this.resolve = resolve);
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface String {
    startsWith(needle: string): boolean;
    endsWith(needle: string): boolean;
}

String.prototype.startsWith ??= function(this: string, needle: string) {
    // eslint-disable-next-line @typescript-eslint/prefer-string-starts-ends-with
    return this.substring(0, needle.length) === needle;
};

String.prototype.endsWith ??= function(this: string, needle: string) {
    // eslint-disable-next-line @typescript-eslint/prefer-string-starts-ends-with
    return this.substring(this.length - needle.length) === needle;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Object {
    assign<T, U>(target: T, source: U): T & U;
}

Object.prototype.assign ??= function <T, U>(target: T, source: U): T & U {
    for (const i in source) {
        // Avoid bugs when hasOwnProperty is shadowed
        if (Object.prototype.hasOwnProperty.call(source, i)) {
            (<any> target)[i] = source[i];
        }
    }
    return <T & U> target;
};

/* eslint-disable no-console */
const DEBUG = window.console && true;
const debug = {
    debug: (DEBUG && console.debug) ? console.debug : function() { },
    log: DEBUG ? console.log : function() { },
    warn: (DEBUG && console.warn) ? console.warn : function() { },
    error: window.console?.error ?? function() { },
};
/* eslint-enable no-console */

type RequireCallback = (..._: any[]) => unknown;
// Map isn't available under ES5
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
const loadedDependencies: { [key: string]: (LoadedDependency | undefined) } = {};
(<any> window).loadedDependencies = loadedDependencies;
// debug.log(loadedDependencies, (<any>window).loadedDependencies);
async function innerDefine(name: string, dependencies: string[], callback: RequireCallback): Promise<unknown> {
    debug.log(`define() for ${name} called`);
    let exportsImported = false;
    const exports = {};
    const loadedDeps = await Promise.all(dependencies.map(async dependency => {
        if (dependency === "exports") {
            exportsImported = true;
            return exports;
        } else if (dependency === "require") {
            return (<any> window).require;
        } else {
            // Handle relative paths, e.g. ./foo/bar requesting ./baz should map to ./foo/baz
            if (dependency.startsWith("./")) {
                const thisPath = name.match(/\//) ? name : importMap[name][0];
                dependency = thisPath.replace(/\/[^/]+$/, dependency.replace("./", "/"));
            }
            return await timedAwait(requireAsync(dependency, undefined, name),
                `require of dependency ${dependency} for define of ${name}`);
        }
    }));

    // The module returns itself as the return value of the define callback
    debug.log("loadedDeps for " + name, loadedDeps);
    let module = callback.apply(null, loadedDeps);
    if (!module && exportsImported) {
        module = exports;
    }
    debug.log(`innerDefine looking up loadedDependency ${name}`);
    const dependency = loadedDependencies[name];
    if (!dependency) {
        throw new Error("Internal error. Dependency should already be in the dictionary.");
    }
    if (dependency.module) {
        throw new Error("dependency loaded more than once!");
    }
    dependency.module = module;
    dependency.resolve(module);
    return module;
}
(<any> window).define = function(name: string, dependencies: string[], callback: RequireCallback) {
    const dependency = new LoadedDependency(name);
    loadedDependencies[name] = dependency;
    const localDefine = makeDefine(name, dependency.resolve);
    localDefine(name, dependencies, callback);
};

// A define function that is called from within a require context, e.g. where the name is determined
// by the preceding call to require and not by the call to define.
type RequireDefine = ((_1: any, _2: any, _3: any) => Promise<void>) & {
    exports: object;
    amd: boolean;
    called: boolean;
};

function makeDefine(autoName: string, resolveModule: (resolution: any) => any, parent?: string): RequireDefine {
    const localDefine = function(_1: any, _2: any, _3: any): Promise<void> {
        define.called = true;

        let name = autoName;
        const args = Array.prototype.slice.call(arguments);
        if (args.length > 1) {
            if (typeof args[0] === "string") {
                name = <string> args.shift();
                // Check for dependency require'd by path, defining itself by name.
                if (name !== autoName) {
                    debug.log(`Instantiating ${autoName} with an explicit name ${name}`);
                    // Make it available under both names
                    const dependency = loadedDependencies[autoName];
                    if (!dependency) {
                        throw new Error(`Unable to find dependency ${name} by alternate name ${autoName}`);
                    }
                    loadedDependencies[name] = dependency;
                }
            }
        } else {
            throw new Error("Unknown define mode!");
        }

        // define with three arguments can only be with a fixed name as the first (handled above)
        if (args.length > 2) {
            debug.error("Unknown define mode", args);
            throw new Error("Unknown define mode!");
        }

        let deps: string[] = [];
        if (args.length === 2) {
            // The only way we can have two parameters left is if the first is the dependencies
            if (Array.isArray(args[0])) {
                deps = <string[]> args.shift();
            } else {
                throw new Error("Unknown define mode");
            }
        }

        if (deps.length > 0) {
            debug.log(`${name} requested`, deps);
        }

        // Try to resolve paths relative to the current module, e.g. cldr/event depending on ../cldr
        for (let i = 0; i < deps.length; ++i) {
            while (deps[i].startsWith("../")) {
                deps[i] = deps[i].substring(3);
            }
        }

        // Only one parameter left: the module itself
        let callback: RequireCallback;
        if (typeof args[0] === "function") {
            callback = <RequireCallback> args[0];
        } else {
            debug.log(`Instantiating ${autoName} via simple initialization`);
            callback = () => args[0];
        }

        return timedAwait(innerDefine(name, deps, callback), `define after eval of ${name} by ${parent}`)
            .then(resolveModule);
    };

    const define: RequireDefine = Object.assign(localDefine, {
        exports: {},
        amd: true,
        called: false,
    });
    return define;
};

async function timedAwait<T>(promise: Promise<T>, name: string) {
    let waited = 0;
    const timer = setInterval(() => {
        waited += 5;
        debug.error(`Promise ${name} still not resolved after ${waited} seconds!`);
    }, 5000);
    const result = await promise;
    clearInterval(timer);
    return result;
}

// tsc complains on top-level `require` directly; rely on `window` contents being directly accessible instead.
(<any> window).require = function(_1: any, _2?: any): any {
    if (arguments.length === 1 && typeof _1 === "string") {
        // This is the synchronous version of require() that can only load previously loaded and cached modules
        debug.log(`require looking up loadedDependency ${_1}`);
        const dependency = loadedDependencies[_1];
        if (dependency && dependency.module) {
            return dependency.module;
        } else {
            throw new Error(`${_1} has not been previously loaded asynchronously! Use \`require([name], callback)\` instead.`);
        }
    }

    // Default asynchronous method
    return requireAsync(_1, _2);
};

// For compatibility with require.js and alameda.js, allow require.config({paths: []}) to be used instead of an importmap.
(<any> globalThis).require.config = function(config: { paths: { [name: string]: string } }) {
    for (const name in config.paths) {
        importMap[name] = [config.paths[name]];
    }
};

// Check if input has an extension. Extension may not be the last thing, as query string parameters are considered.
const hasExtensionRegex = /\.[^\/]+$/;
async function requireAsync(name: string | string[], callback?: RequireCallback, parent?: string): Promise<any> {
    // ES3 and ES5 don't support accessing `arguments` in an async function
    debug.log("requireAsync called with arguments ", name, callback, parent);

    // If we're being called directly by an external script, the async form takes an array as the first parameter.
    if (Array.isArray(name)) {
        const deps = await Promise.all(name.map(dep => requireAsync(dep, undefined, parent)));
        callback?.apply(null, deps);
        return undefined;
    }

    {
        // This scope is unnecessary but it stops TypeScript from confusing a
        // possibly null/undefined `dependency` with the definitely valid one
        // that we later assign to it.
        debug.log(`requireAsync looking up loadedDependency ${name}`);
        const dependency = loadedDependencies[name];
        if (dependency) {
            // Either already loaded or simultaneously being loaded.
            return dependency.module ?? await dependency.promise;
        }
    }

    if (parent) {
        debug.log(`${parent} is loading ${name}`);
    } else {
        debug.log(`loading ${name}`);
    }
    const dependency = new LoadedDependency(name);
    loadedDependencies[name] = dependency;

    let path = name;
    let extraPaths: string[] = [];
    if (!name.startsWith("http:") && !name.startsWith(".") && !name.startsWith("/")) {
        const urls = importMap[name];
        if (!urls || !urls[0]) {
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

    debug.log(`Loading ${name} from ${path}`);
    const xhr = new XMLHttpRequest();
    const requirePromise = new Promise((resolve, reject) => {
        xhr.onreadystatechange = function() {
            if (this.readyState === 4 && this.status === 200) {
                const js = xhr.responseText;
                const define = makeDefine(name, resolve, parent);

                // This must be defined; the evaluated JS might use it if it only understands CommonJS
                const exports = define.exports;
                const module = { exports };

                debug.log(`importing ${name} via eval`);
                // debug.debug(js);
                // eslint-disable-next-line no-eval
                eval(js);
                debug.debug(`finished eval of ${name}`);
                if (define.called) {
                    // Loaded an AMD/UMD module
                    debug.log(`loaded AMD module ${name}`, dependency.module);
                } else {
                    // Don't use the `exports` name/reference because if module.exports is overridden
                    // by the eval'd code, exports may no longer point to the same entity.

                    // CommonJS if module.exports is non-empty
                    if ((function(obj) { for (const _ in obj) { return true; } return false; })(module.exports)) {
                        debug.log(`loaded CommonJS module ${name}`, module.exports);
                    } else {
                        debug.log(`loaded global/legacy script ${name}`);
                    }
                    resolve(module.exports);
                    dependency.module = module.exports;
                    dependency.resolve(module.exports);
                }
            }
        };
        xhr.onerror = reject;
        xhr.open("GET", path);
        xhr.send();
    });

    // We wait for the resolution which guarantees loadedDependencies contains this self-same module
    await timedAwait(Promise.all([requirePromise, ...(extraPaths.map(load))]), `overall load of dependency ${name} for ${parent}`);
    const module = await timedAwait(dependency.promise,
        `loadedDependency promise for ${name} from ${parent} after requirePromise resolved!`);
    // Don't bother calling callback, we never set it internally for non-array require calls.
    return module;
}

function load(urls: string[] | string): Promise<void | void[]> {
    (window as any).loadjs ??= load;

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
    if (DEBUG) {
        // debug.log(`Starting load of ${url}`);
        start = new Date().getTime();
    }

    try {
        if (/\.css$/i.test(url)) {
            await loadCss(url);
        } else {
            await loadjs(url);
        }

        if (start) {
            const elapsed = (new Date().getTime()) - start;
            debug.log(`${url} loaded in ${elapsed}ms`);
        }
    } catch (ex) {
        debug.error(`Error loading ${url}: `, ex);
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
        } else if (el.attachEvent !== undefined) {
            el.attachEvent(`on${name}`, callback);
        } else {
            throw new Error(`Error creating ${name} listener!`);
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

        document.head.appendChild(link);
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
                    document.head.appendChild(script);
                    resolve();
                } else if (s.readyState === "loaded") {
                    // Attempting to enumerate the children of the script tag
                    // will result in s.readyState changing to "loading" if
                    // there is an error (yes, it's a hack - but then again, I
                    // don't think IE8 is going to be seeing any updates that
                    // will change this behavior any time soon!)
                    /* tslint:disable-next-line: no-empty */
                    (function(_) { })(script.children);
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
            document.head.appendChild(script);
        }

        // Only assign this once the handlers are in place
        script.src = url;
    });
}
