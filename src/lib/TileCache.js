import { openDB } from "idb";

export const indexDbPromise = openDB("tiles", 1, {
  upgrade(db) {
    db.createObjectStore("tiles");
  },
});

export async function fetchAndCache(url, successCb, errorCb, force) {
  if (!force) {
    const cachedBlob = await (await indexDbPromise).get("tiles", url);
    if (cachedBlob) {
      console.log(`Already cached ${url}`);
      return false;
    }
  }
  fetch(url)
    .then((response) => {
      if (response.ok) {
        response.blob()
          .then(async (blob) => {
            await (await indexDbPromise).put("tiles", blob, url);
            if (successCb) successCb(blob);
            console.log(`downloaded & cached ${url}`);
          });
      }
    })
    .catch((_) => {
      console.log(`error precaching ${url}`);
      if (errorCb) errorCb();
    });
  return true;
}

export const cachingTileLoadFunction = async (tile, src) => {
  const image = tile.getImage();

  const cachedBlob = await (await indexDbPromise).get("tiles", src);
  let objUrl;
  if (cachedBlob) {
    console.log(`${src} already cached.`);
    objUrl = URL.createObjectURL(cachedBlob);
    image.onload = function () {
      URL.revokeObjectURL(objUrl);
    };
    image.src = objUrl;
  } else {
    console.log(`${src} not found in cache`);
    await fetchAndCache(src, (blob) => {
      objUrl = URL.createObjectURL(blob);
      image.onload = function () {
        URL.revokeObjectURL(objUrl);
      };
      image.src = objUrl;
    }, null, true);
  }
};
