// Stub for the `electron` module so main-process helpers can be probed in plain Node.
module.exports = {
  app: {
    getPath: (name) => {
      if (name === 'desktop') return process.env.PROBE_DESKTOP || '';
      return require('node:path').join(process.env.APPDATA || '', 'desktop-manager');
    }
  }
};
