const generic = require('./generic');

module.exports = async function extract(url, opts = {}) {
  return generic(url, { ...opts, platform: 'facebook' });
};
