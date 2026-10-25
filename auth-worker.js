import { handleXOauth } from './server/x_oauth.js';

export default {
  async fetch(request, env) {
    return handleXOauth(request, env);
  },
};
