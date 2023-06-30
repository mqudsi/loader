// We are only using requireJS because TypeScript refuses to compile our own code into a
// single JS file without some form of module support. We are not using modules for
// anything else. If we leave the require/define functions brought in by requireJS
// in-place, jQuery plugins will fail to register correctly as they'll try to modularize
// themselves necessitating use via the requireJS interface rather than the global jQuery
// object.

if ((window as any).require) {
    (window as any).require = undefined;
    (window as any).define = undefined;
}

const head = document.getElementsByTagName("head")[0];

export function load(urls: string[] | string): Promise<void | void[]> {
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
    if (window.console && Date.prototype.getTime) {
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
        if (start && window.console && Date.prototype.getTime) {
            const elapsed = (new Date().getTime()) - start;
            console.log(`${url} loaded in ${elapsed}ms`);
        }
        /* eslint-enable no-console */
    } catch (ex) {
        /* eslint-disable no-console */
        if (window.console) {
            console.log(`Error loading ${url}: `, ex);
        }
        /* eslint-enable no-console */
        throw ex;
    }
}

interface LegacyHTMLElement extends HTMLElement {
    attachEvent?: (name: string, callback: EventListenerOrEventListenerObject) => void;
}

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
            console.log(`Error creating ${name} listener!`);
        }
        /* eslint-enable no-console */
        return false;
    }
}

/* function firefoxVersion(): number|undefined {
    // We are only concerning ourselves with versions of Firefox earlier than 42,
    // so this does not need to be perfect or precise.
    const regex = /Mozilla\/5.0.*Firefox\/(\d+)[\d.]*$/;
    const matches = navigator.userAgent.match(regex);
    if (matches) {
        return parseInt(matches[1]);
    }
}*/

function loadCss(url: string) {
    return new Promise((resolve, reject) => {
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
    return new Promise((resolve, reject) => {
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
            script.onload = resolve;
            script.onerror = reject;
            head.appendChild(script);
        }

        // Only assign this once the handlers are in place
        script.src = url;
    });
}
