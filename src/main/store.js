// Persistence via electron-store (JSON in the OS app-data folder).
// Holds the font-list cache, saved brand kits, and last-session state.

const Store = require('electron-store');

const store = new Store({
  name: 'null-brand-builder',
  defaults: {
    fontCache: null, // { families, count, scannedAt }
    kits: {}, // name -> kit state
    lastSession: null, // most recent unsaved working state
    favorites: [], // global list of favorited font family names
    googleFontsApiKey: '', // user-supplied Google Fonts Developer API key
    gfontsCache: null, // { at, items } catalog cache
    preferences: {},
  },
});

module.exports = store;
