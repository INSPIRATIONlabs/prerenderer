# Prerenderer for stenciljs

This prerenderer is a standalone solution to prerender pages created with stencil [stenciljs](https://www.stenciljs.com).

## Todo
- Use puppeteer-core and detect the installation path of a installed chromium / chrome version
- Unit tests
- Create a function to predefine a list of urls which should be rendered instead of crawling
- Realtime SSR
- Including with stencil executable / core
- Copy build folders to destination
- ~~Solving waitFor load completed~~

## Run
If installed globally run
```js
prerenderer srcFolder dstFolder
```

If running from a local checkout run
```js
node ./dist/PrerenderManager.js srcFolder dstFolder
```

After a npm run build without activated prerenderer the sourcefolder is typically www. Currently it's needed to create the destination folder manually and copy the build folders after the prerender into it.

## Building the package

```js
npm run build
```
