import worker from '../src/worker.js';
import {bufferLocalRequest} from './local-worker-transport.mjs';
export {RankingObject} from '../src/worker.js';

// Used only by local-dev.mjs. wrangler.jsonc still deploys src/worker.js.
export default {
  async fetch(request,env,ctx){
    const buffered=await bufferLocalRequest(request);
    return buffered instanceof Response?buffered:worker.fetch(buffered,env,ctx);
  }
};
