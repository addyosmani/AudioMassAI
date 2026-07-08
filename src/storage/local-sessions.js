/**
 * Local session persistence.
 *
 * Stores editing sessions (the full audio buffer plus metadata and a waveform
 * thumbnail) in IndexedDB. Channel data is LZ4-compressed through the vendored
 * WASM codec (`lz4BlockCodec` global, loaded via <script> in index.html).
 */

const DB_NAME = 'audiomass';
const DB_VERSION = 1;

let db;

const compressors = {
  l4z: {
    ready: false,
    loading: false,
    compress: null,
    decompress: null,
    init: function (callback) {
      const codec = this;
      codec.loading = true;

      let lz4Instance;

      // eslint-disable-next-line no-undef
      lz4BlockCodec.createInstance('wasm').then((instance) => {
        lz4Instance = instance;

        codec.ready = true;
        codec.loading = false;
        codec.compress = function (input) {
          if (!lz4Instance) {
            return input instanceof ArrayBuffer ? new Uint8Array(input) : input;
          }
          return lz4Instance.encodeBlock(input, 0);
        };
        codec.decompress = function (input, offset, size) {
          if (!lz4Instance) {
            return input instanceof ArrayBuffer ? new Uint8Array(input) : input;
          }
          return lz4Instance.decodeBlock(input, 0, size);
        };

        callback && callback();
      });
    },
  },
};

const ACTIVE_COMPRESSION = 'l4z';

export class LocalSessions {
  constructor(app) {
    this._app = app;
    /** True once the database connection is open. */
    this.on = false;
  }

  /** Open (and if needed create) the IndexedDB database. */
  Init(callback) {
    const sessions = this;
    const app = this._app;

    if (this.on) {
      callback && callback();
      return;
    }

    if (!window.indexedDB) {
      callback && callback('err');
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = function () {
      callback && callback('err');
    };

    request.onupgradeneeded = function (event) {
      const database = event.target.result;
      database.createObjectStore('sessions', { keyPath: 'id' });
    };

    request.onsuccess = function (event) {
      db = event.target.result;

      db.onerror = function (error) {
        console.log(error);
      };

      setTimeout(function () {
        sessions.on = true;

        callback && callback();
        app.fireEvent('DidOpenDB', sessions);
      }, 120);
    };
  }

  /** Compress and persist an AudioBuffer as a named session. */
  SaveSession(buffer, id, name) {
    const sessions = this;
    const app = this._app;

    const codec = compressors[ACTIVE_COMPRESSION];
    if (!codec.loading && !codec.ready) {
      codec.init(function () {
        sessions.SaveSession(buffer, id, name);
      });
      return;
    }

    const channelCount = buffer.numberOfChannels;
    const compressedChannels = [];
    const originalByteLengths = [];

    for (let i = 0; i < channelCount; ++i) {
      const channelData = buffer.getChannelData(i);

      originalByteLengths.push(channelData.buffer.byteLength);
      const compressed = codec.compress(channelData.buffer, 0);
      compressedChannels.push(
        compressed.buffer.slice(
          compressed.byteOffset,
          compressed.byteLength + compressed.byteOffset
        )
      );
    }

    const record = {
      id: id,
      name: name,
      created: new Date().getTime(),
      data: compressedChannels,
      data2: originalByteLengths,
      durr: buffer.duration.toFixed(3) / 1,
      chans: channelCount,
      comp: ACTIVE_COMPRESSION,
      thumb: app.engine.GetWave(buffer),
      samplerate: buffer.sampleRate,
    };

    const transaction = db.transaction(['sessions'], 'readwrite');
    const addRequest = transaction.objectStore('sessions').add(record);

    addRequest.onerror = function (error) {
      app.fireEvent('ErrorDB', error);

      console.log('error storing data');
      console.error(error);
    };

    transaction.oncomplete = function (event) {
      app.fireEvent('DidStoreDB', record, event);
    };
  }

  /** Load a session by id, decompressing its channel data. */
  GetSession(id, callback) {
    const transaction = db.transaction(['sessions'], 'readonly');
    const request = transaction.objectStore('sessions').get(id);

    request.onsuccess = function (event) {
      const record = event.target.result;

      const decompressRecord = function (codec) {
        const channelBuffers = [];

        for (let i = 0; i < record.data.length; ++i) {
          const decompressed = codec.decompress(record.data[i], 0, record.data2[i]);
          channelBuffers.push(
            decompressed.buffer.slice(
              decompressed.byteOffset,
              decompressed.byteLength + decompressed.byteOffset
            )
          );
        }

        record.data = channelBuffers;
      };

      if (record && record.comp) {
        const codec = compressors[ACTIVE_COMPRESSION];
        if (!codec.loading && !codec.ready) {
          codec.init(function () {
            decompressRecord(codec);
            callback && callback(record);
          });
          return;
        }

        decompressRecord(codec);
      }

      callback && callback(record);
    };
  }

  DelSession(id, callback) {
    const transaction = db.transaction(['sessions'], 'readwrite');

    const request = transaction.objectStore('sessions').delete(id);
    request.onsuccess = function () {
      callback && callback(id);
    };
  }

  /** List all stored sessions, most recent first. */
  ListSessions(callback) {
    const transaction = db.transaction(['sessions'], 'readonly');
    const request = transaction.objectStore('sessions').openCursor();
    const results = [];

    request.onerror = function () {
      console.error('error fetching data');
    };
    request.onsuccess = function (event) {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        results.sort(function (a, b) {
          if (a.created > b.created) return -1;
          if (a.created < b.created) return 1;
          return 0;
        });

        callback && callback(results);
      }
    };
  }
}
