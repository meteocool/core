export default class Router {
  static ParseURL(url) {
    const parts = new URL(window.location.href).searchParams;
    if (parts.length > 1) {
      console.log(parts);
      Router.parseFragment(parts[1]);
    }
  }

  static parseFragment(fragment) {
    return fragment
      .split("&")
      .map((e) => {
        const parts = e.split("=");
        if (parts.length === 2) {
          return [parts[0], parts[1]];
        }
        if (parts.length === 1) {
          return [parts[0], "true"];
        }
        return [];
      });
  }
}

export function ParseURL() {
  return new URL(document.location).searchParams.entries();
}

window.pu = ParseURL;
