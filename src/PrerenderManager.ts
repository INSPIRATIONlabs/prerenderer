import {Prerenderer} from './Prerenderer';
import * as express from 'express';
import * as path from 'path';
import * as dbg from 'debug';
import * as queue from 'queue';
import * as fs from 'fs-extra';

const debug = dbg('Prerenderer');

export interface PrerenderManagerOptions {
  queue?: PrerenderManagerQueueOptions;
  http?: PrerenderManagerHttpOptions;
  output?: PrerenderManagerOutputOptions;
}

export interface PrerenderManagerQueueOptions {
  concurrency?: number;
  timeout?: number;
  autostart?: boolean;
}

export interface PrerenderManagerHttpOptions {
  directory?: string;
  port?: number;
}

export interface PrerenderManagerOutputOptions {
  directory?: string;
}

export class PrerenderManager {
  // the port for the express webserver
  private port: number = 1337;
  // the express app
  private app: express.Express = express();
  // the http directory
  private sourceWebDir: string = './www';
  // the output directory
  private outputDir: string = './output';
  // the already processed elements to prevent duplicates
  private processedQueue: Set<String> = new Set();
  // the prerenderer
  private prerenderer: Prerenderer = new Prerenderer();
  // the queue
  private q: any;
  // the default options for the prerendermanager
  private defaultQueueOptions: PrerenderManagerQueueOptions = {
    concurrency: 25
  };
  // the prerenderer host
  private pHost: string = 'http://localhost:' + this.port;
  // the start path
  private startRenderPath: string = '/';
  // the start url (includes host and path)
  private startUrl = this.pHost + this.startRenderPath;
  // catches error results
  private errResults: any[] = [];
  // rendered pages counter
  private renderedPages: number = 0;

  constructor(options?: PrerenderManagerOptions) {
    if(options) {
      if( options.queue) {
        this.q = queue(options.queue);
      } else {
        this.q = queue(this.defaultQueueOptions);
      }
      if(options.http) {
        if(options.http.directory) {
          this.sourceWebDir = options.http.directory;
        }
        if(options.http.port) {
          this.port = options.http.port;
        }
      }
      if(options.output) {
        if(options.output.directory) {
          this.outputDir = options.output.directory;
        }
      }
    }
  }

  /**
   * Wrapper for promise based queue start function
   */
  public startQueue (queue) {
    return new Promise((resolve, reject) => {
      queue.start(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  start() {
    // start the express server
    this.startServer();
    // listen function for the express server
    this.app.listen(this.port, async () => {
      try {
        await fs.remove(this.outputDir);
        await fs.ensureDir(this.outputDir);
      } catch(e) {
        console.log('Error while creating output directory ' + e.message);
      }
      try {
        console.log('copying build and assets');
        const fileList = await fs.readdir(this.sourceWebDir);
        for(const fsel of fileList) {
          if(fsel !== 'index.html') {
            await fs.copy(this.sourceWebDir + '/' + fsel, this.outputDir + '/' + fsel);
          }
        }
      } catch(e) {
        console.log('error while copying files ' + e.message);
      }
      // initial get of / to get the first url's
      await this.getPage(this.startUrl);
      // start the queue
      await this.startQueue(this.q);
      try {
        // destruct the prerenderer (close chrome)
        const result = await this.prerenderer.destruct();
        console.log('all done');
      } catch(e) {
        console.log('queue ended with error: ' + e.message);
      }
      try {
        console.log('copying build and assets');
        const fileList = await fs.readdir(this.sourceWebDir);
        for(const fsel of fileList) {
          if(fsel !== 'index.html') {
            await fs.copy(this.sourceWebDir + '/' + fsel, this.outputDir + '/' + fsel);
          }
        }
      } catch(e) {
        console.log('error while copying files ' + e.message);
      }
      // console output
      console.log('Pages rendered: ' + this.renderedPages);
      console.log('Error count: ' + this.errResults.length);
      console.log('Errors: ' + JSON.stringify(this.errResults));
      // exit the process
      process.exit();
    });
  }

  startServer() {
    // serve static assets normally
    this.app.use(express.static(this.sourceWebDir));

    // handle every other route with index.html, which will contain
    // a script tag to your application's JavaScript file(s).
    this.app.get('*', (request, response) => {
      response.sendFile(path.resolve(this.sourceWebDir + '/index.html'));
    });
  }

  async getPage(url) {
    // check if the element
    if(!this.processedQueue.has(url)) {
      try {
        console.log('Render: ' + url);
        // execute the renderer
        const res = await this.prerenderer.runRender(url);
        // increase the counter
        this.renderedPages++;
        // add the element to the processed queue to ensure that there are no duplicates
        this.processedQueue.add(url);
        // check if it returns links
        if(res.links && res.links.length > 0) {
          for(const link of res.links) {
            // check if the link has already been processed before adding it to the queue
            if(!this.processedQueue.has(this.pHost + link)) {
              // push every link
              this.q.push(() => this.getPage(this.pHost + link));
            }
          }
        }
        // check if it returns errors
        if(res.errors && res.errors.length > 0) {
          debug('Errors fetched:' + res.url);
          // create a new error object
          const errResult = {
            url: res.url,
            errors: res.errors
          };
          // push the errors with the url to the error result array to create a summary later
          this.errResults.push(errResult);
        }
        // write the content to the file based on the url
        await this.prerenderer.writeContent(res.url.replace(this.pHost, ''), res.html, this.outputDir);
      } catch(e) {
        // if the error has been catched create a error object with the url
        const errResult = {
          url: queue[0],
          errors: [e]
        };
        // push the error to the error result array for the summary
        this.errResults.push(errResult);
      }
    } else {
      // remove from the queue if it's a duplicate
      this.q.shift();
      // debug output for the duplicate
      debug('duplicate ' + url);
    }
  }
}
