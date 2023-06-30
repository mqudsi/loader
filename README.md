# AIO async JS loader

This is an all-in-one fully-async JS/CSS loader with no dependencies, that can be used to load (or dynamically load!) AMD, CommonJS, nodejs, or regular "include this script" JS libraries. It is compatible with the regular AMD `require()` syntax but also provides a fully async interface to the same (`requireAsync()`) as well as overrides for recursive asynchronous loading of target library dependencies.

The loader script itself is compatible with IE6 and above, but a JSON polyfill is required under IE6 and IE7 or Firefox versions 3 or lower.

This project also supports the use of "import maps" to declare the remote URL to any named (top-level or transitive) `require()` dependency.

## Basic usage

This library should be (synchronously) loaded via a `<script src="..."></script>` tag before asynchronously loading your own script and its dependencies. Ideally, this `<script>` tag should be at the end of `<body>`, after all HTML content has been parsed and the browser has enough information to render the page. The use of `async` or `defer` in the `<script>` tag is supported, but you might need to use the `onload` property to use the library.

```html
<!-- Load this library -->
<script type="text/javascript" src="./loader.js"></script>

<!-- Use it to load your own application or library -->
<script type="text/javascript">
	require("js/app.js", App => {
		var app = new App();
		// ...
	});
</script>
```

You can use the above syntax even if the library you are loading is not an AMD or CommonJS library, though in that case you won't get the `App` value in the callback - just use the library normally in the callback instead:

```html
<script type="text/javascript" src="./loader.js"></script>
<script type="text/javascript">
	require("js/jquery.js", () => {
		$("#app").show();
	});
</script>
```

## Dynamic usage

This loader can be loaded as an import and can also be used to dynamically (asynchronously) import libraries and dependencies.

```javascript
import { requireAsync } from "./loader";

async function foo() {
	// Vue is normally loaded with require("vue").default, but here we load asynchronously
	const Vue = (await requireAsync("vue")).default;
}
```

# Import maps for nodejs support

The biggest obstacle to using node packages in the browser is the difficulty with transitively loading dependencies as node depends on filesystem access to determine the paths to dependencies. With this script, you can specify the path to any named dependency directly.

```html
<script type="importmap">
	{
	"imports": {
		"vue": "https://cdn.jsdelivr.net/npm/vue/dist/vue.min.js",
		"globalize": "https://cdnjs.cloudflare.com/ajax/libs/globalize/1.6.0/globalize.min.js",
		"globalize/number": "https://cdnjs.cloudflare.com/ajax/libs/globalize/1.6.0/globalize/number.min.js",
		"globalize/plural": "https://cdnjs.cloudflare.com/ajax/libs/globalize/1.6.0/globalize/plural.min.js",
		"globalize/relative-time": "https://cdnjs.cloudflare.com/ajax/libs/globalize/1.6.0/globalize/relative-time.min.js",
		"cldrjs": "https://cdnjs.cloudflare.com/ajax/libs/cldrjs/0.5.1/cldr.min.js",
		"cldr": "https://cdnjs.cloudflare.com/ajax/libs/cldrjs/0.5.1/cldr.min.js",
		"cldr/event": "https://cdnjs.cloudflare.com/ajax/libs/cldrjs/0.5.1/cldr/event.min.js",
		"cldr/supplemental": "https://cdnjs.cloudflare.com/ajax/libs/cldrjs/0.5.1/cldr/supplemental.min.js",
		"relative-time": "https://unpkg.com/relative-time@1.0.0/dist/relative-time.js",
		"zoned-date-time": "https://unpkg.com/zoned-date-time@1.0.0/src/zoned-date-time.js",
	}
}
</script>

<script type="text/javascript" src="./loader.js"></script>

<!-- Now we can import our library which was compiled w/ dependencies on the node packages named above -->
<script type="text/javascript">
	require("./app.js", App => {
		// `require()` will intercept calls to dependencies, e.g. `require("vue")` will load `vue.min.js`
		// from the path declared above.
		var app = new App();
	});
</script>
```

# License and Credits

This library was sponsored by NeoSmart Technologies and developed by Mahmoud Al-Qudsi. It is released under the terms of the MIT license.

