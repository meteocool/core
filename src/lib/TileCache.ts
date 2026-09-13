import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { Map as OlMap, MapEvent } from "ol";
import type XYZ from "ol/source/XYZ";
import type { Extent } from "ol/extent";
import type { TileCoord } from "ol/tilecoord";
import { tileCacheDownloaded, tileCacheHit, tileCachePending } from "../stores";

/**
 * Precaches forecast tiles into IndexedDB.
 *
 * Currently inert: every call site in RadarCapability is commented out (see the
 * "disable caching for now" and "Undo caching" commits), so nothing constructs
 * a tileset or installs the loading function. Kept, and typed, rather than
 * deleted.
 */
export class MeteoTileCache {
  private zoom: number;

  private extent: Extent | null;

  private map: OlMap | null;

  private source: XYZ | null;

  private idb: Promise<IDBPDatabase>;

  private idbTilesets: Promise<IDBPDatabase>;

  constructor() {
    this.zoom = 8;
    this.extent = null;
    this.map = null;
    this.source = null;

    this.idb = openDB("tiles2", 1, {
      upgrade(db) {
        db.createObjectStore("tiles");
        db.createObjectStore("ttl");
      },
    });
    this.idbTilesets = openDB("tilesets2", 1, {
      upgrade(db) {
        db.createObjectStore("tilesets");
      },
    });
    window.tc = this;
    setTimeout(async () => { await this.expire(); }, 5000);
  }

  setMap(map: OlMap) {
    this.map = map;
    this.setZoom();
    map.on("moveend", (e) => this.mapObserver(e));
  }

  setSource(source: XYZ) {
    this.source = source;
    this.setZoom();
  }

  getTileLoadingFunction() {
    return async (tile, src) => {
      tileCachePending.set(new Date());
      await MeteoTileCache.fetchAndCache(
        await this.idb,
        src,
        (blob, cached) => {
          const objUrl = window.URL.createObjectURL(blob);
          tile.getImage().onload = function () {
            window.URL.revokeObjectURL(objUrl);
          };
          tile.getImage().src = objUrl;
          if (cached) {
            tileCacheHit.set(new Date());
          } else {
            tileCacheDownloaded.set(new Date());
          }
        },
      );
    };
  }

  mapObserver(_event: MapEvent) {
    if (!this.map) return;
    this.extent = this.map.getView().calculateExtent(this.map.getSize());
    this.setZoom();
    console.warn(`Map moved at z=${this.map.getView().getZoom()}`);
    (async () => this.cacheViewport())();
  }

  async cacheViewport() {
    const tx = (await this.idbTilesets).transaction("tilesets");
    for await (const cursor of tx.store) {
      this.cacheTileset(String(cursor.key));
    }
  }

  setZoom() {
    if (!this.source || !this.map) return;
    const grid = this.source.getTileGrid()!;
    const zoom = Math.round(this.map.getView().getZoom() ?? 0) - 1;
    this.zoom = Math.max(Math.min(zoom, grid.getMaxZoom()), grid.getMinZoom());
  }

  async expire() {
    console.log("Expiring tile cache");
    const tx = (await this.idb).transaction("ttl");
    const toDelete: IDBValidKey[] = [];
    for await (const cursor of tx.store) {
      if (cursor.value < Date.now()) {
        toDelete.push(cursor.key);
      }
    }
    for (const k of toDelete) {
      await (await this.idb).transaction("ttl", "readwrite").store.delete(k);
      await (await this.idb).transaction("tiles", "readwrite").store.delete(k);
    }
    setTimeout(async () => { await this.expire(); }, 5 * 60 * 1000);
  }

  forEachTileCoord(cb: (coord: TileCoord) => void) {
    if (!this.source) {
      console.log("source unset!");
      return;
    }
    if (!this.extent) return;
    this.source.getTileGrid()!.forEachTileCoord(this.extent, this.zoom, cb);
  }

  trackTileset(url: string, validMins: number) {
    (async () => (await this.idbTilesets).put("tilesets", { url, validMins }, url))();
  }

  cacheTileset(tilesetUrl: string) {
    this.forEachTileCoord(async (tileCoord) => {
      console.log(`Precaching ${tilesetUrl} @ ${tileCoord}`);
      tileCachePending.set(new Date());
      const [z, x, y] = tileCoord;
      await MeteoTileCache.fetchAndCache(
        await this.idb,
        `${tilesetUrl}${z}/${x}/${(2 ** z) - y - 1}.png`,
        (_, cached) => {
          if (cached) {
            tileCacheHit.set(new Date());
          } else {
            tileCacheDownloaded.set(new Date());
          }
        },
      );
    });
  }

  static async fetchAndCache(idb, url, successCb, expiryMin = 5) {
    const tx = (await idb).transaction("tiles", "readonly");
    const store = tx.objectStore("tiles");
    const cachedBlob = await store.get(url);
    if (cachedBlob) {
      //console.log(`Already cached ${url}`);
      if (successCb) successCb(cachedBlob, true);
      return;
    }

    // XXX error handling
    const response = await fetch(url);
    const imageData = await response.blob();
    if (successCb) successCb(imageData);

    const storeW = (await idb).transaction("tiles", "readwrite").objectStore("tiles");
    await storeW.put(imageData, url);

    await (await idb).put("ttl", Date.now() + (expiryMin * 60 * 1000), url);
  }
}

export const mcTileCache = new MeteoTileCache();
