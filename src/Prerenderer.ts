import { PrerenderResult } from './PrerenderResult';
import * as fs from 'fs';
import * as util from 'util';
import { minify }from 'html-minifier';
import * as cheerio from 'cheerio';
import * as mkdirp from 'mkdirp-promise';
import * as puppeteer from 'puppeteer';
import * as dbg from 'debug';

// init namespace for debug
const debug = dbg('Prerenderer');

// promisified version of file write
const writeFile = util.promisify(fs.writeFile);
// promisified version of timeout
const timeout = ms => new Promise(res => setTimeout(res, ms))

export class Prerenderer {

  // chrome browser instance
  private chromeInstance: puppeteer.Browser;
  // default render host
  private pHost = 'http://localhost:1337';

  /**
   * Initializes chrome in the background for headless rendering
   */
  private async startBrowser() {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
      slowMo: 100 // slow down by 100ms
    });
    return browser;
  }

  /**
   * Start rendering
   * @param url {string} url to render
   * @param port {number} port for debugging connection
   */
  public async runRender(url: string) {
    // create a instance for the resultset
    const renderResult = new PrerenderResult();
    // set the url to the result
    renderResult.url = url;
    try {
      // check if chrome is already available
      if(!this.chromeInstance) {
        debug('Init chrome instance');
        // start the browser
        this.chromeInstance = await this.startBrowser();
        debug('Chrome started');
      }
      // create a new tab
      const page: puppeteer.Page = await this.chromeInstance.newPage();
      debug('Go to '+ url);
      // get browser errors (if they occur)
      page.on('error', err=> {
        // push the errors to the renderResults
        renderResult.errors.push(err);
      });
      // get errors on the page (if they occur)
      page.on('pageerror', pageerr=> {
        // push the errors to the renderResults
        renderResult.errors.push(pageerr);
      });
      // go to the url
      await page.goto(url, { waitUntil: 'networkidle0'});
      // search for internal links on the page
      renderResult.links = await this.searchLinks(page); 
      // get the html page content
      let htmlresult = await page.content();
      debug('Got page content for ' + url);
      // close the tab in the browser
      // if(htmlresult && htmlresult.length > 0) {
      //   // optimize the html
      //   // @todo improve settings
      //   htmlresult = this.optimizeHtml(htmlresult);
      // }
      // set the html to the resultset
      renderResult.html = htmlresult;
      // check if there is html
      if(htmlresult && htmlresult.length > 0 ) {
        const $ = cheerio.load(htmlresult);
        // read all links in the content and add them to the renderResult links attribute
        // renderResult.links = this.readLinks($);
        // write the server side rendering information to describe parents and children
        renderResult.html = this.writeSsrInfo($);
      }
      debug('Returned parsed content ' + url);
    } catch (err) {
      debug('Error: ' + err.message);
      // push the erors to the renderResult
      renderResult.errors.push(err.message);
    }
    return renderResult;
  }

  public async searchLinks(page: puppeteer.Page) {
    // everything in evaluate runs in the context of the browser
    const anchorRes = await page.evaluate((pHost) => {
      // creates a new set to ensure that the links are unique
      const linkSet = new Set();
      // find the links and convert to an Array
      const links = Array.from(document.querySelectorAll('a'));
      // run the map function on the link array
      links.map(link => {
        // check if it's a local link
        if(link.href && link.href.startsWith(pHost)) {
          // add the link to the set
          linkSet.add(link.href.replace(pHost,''));
        }
      });
      // return an array as a Set could not be returned from the browser context
      return Array.from(linkSet);
    }, this.pHost);
    return anchorRes;
  }

  /**
   * Minify the html content
   * @param html {string} html string
   * @param options: {any} options for the minifier
   */
  public optimizeHtml(html: string, options: any = { minifyCSS: true }) {
    return minify(html, options);
  }

  /**
   * Apply server side rendering attributes
   * @param $ {any} the virtual dom provided by cheerio
   * @description Ensures that the components are unique in the dom when the client side JS is applied
   */
  public writeSsrInfo($: any) {
    debug('Adding SSR info');
    let ssrId = 0;
    // declare function to use recursively on every child of body and their children
    const setSsrV = function (i, el) {
      // set ssrv only if element is a component; all components of one level get their ssrv before their children
      if ($(this).hasClass('hydrated')) {
        $(this).attr('ssrv', ssrId++);
      }
      // recursively iterate over children
      $(this).children().each(setSsrV);
    };

    // declare function to check wether given children of an element have further nested children
    const hasChildNodes = (children) => {
      if (children) {
        for (const child of children) {
          if (child.vtag !== 'slot' || hasChildNodes(child.children)) {
            // child or sub-children have component
            return true;
          }
        }
      }
      // no nested component
      return false;
    };

    // initialize element crawl to set ssrv for all components
    $('body').children('.hydrated').each(setSsrV);

    // iterate over all elements in the body
    $('body *').each(function (i, el) {
      // get the ssrv of the closest hydrated parent or the own ssrv
      const parentId = ($(this).parent().closest('.hydrated').attr('ssrv')
        || $(this).closest('.hydrated').attr('ssrv'));
      // get the index of the current child in its parent's list of children
      const childIdx = $(this).parent().children().index($(this));
      // assign ssrc based on parentId, index of current child and the appended nesting signifier
      // (if there are no nested components, ssrc ends with a '.')
      $(this).attr('ssrc', [parentId, childIdx].join('.')
        + (hasChildNodes($(this).children().toArray()) ? '' : '.'));
    });
    // set the date as base ssr
    $('html').attr('ssr', new Date().toISOString());
    debug('finished SSR elements');
    return $.html();
  }

  public async writeContent(url: string, content, outputFolder?: string) {
    if(outputFolder) {
      outputFolder = outputFolder + '/' + url + '/';
    } else {
      outputFolder = './output/' + url + '/';
    }
    await mkdirp(outputFolder);
    await writeFile(outputFolder + '/index.html', content);
  }

  async destruct() {
    debug('destructing chome');
    if(this.chromeInstance) {
      // close the chrome instance
      this.chromeInstance.close();
      this.chromeInstance = undefined;
      debug('chrome instance destructed');
    }
  }
}
