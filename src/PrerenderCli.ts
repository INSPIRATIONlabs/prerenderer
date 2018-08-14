#!/usr/bin/env node
import { PrerenderManager, PrerenderManagerOptions } from './PrerenderManager';
const options: PrerenderManagerOptions = {};
const [,, ...args] = process.argv;
if(args[0]) {
  options.http = {};
  options.http.directory = args[0];
}
if(args[1]) {
  options.output = {};
  options.output.directory = args[1];
}
const manager = new PrerenderManager(options);
manager.start();
