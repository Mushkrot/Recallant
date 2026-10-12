import { URL } from "node:url";

const nativeFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = new URL(input);
  if (url.hostname === process.env.RECALLANT_SMOKE_FETCH_HOST) {
    url.protocol = "http:";
    url.hostname = "127.0.0.1";
    url.port = process.env.RECALLANT_SMOKE_FETCH_PORT;
  }
  return nativeFetch(url, init);
};
