// Shamelessly copypasted from https://stackoverflow.com/questions/9153718/change-the-style-of-an-entire-css-class-using-javascript/14249194

export function cssRules() {
  const rules = {};
  for (let i = 0; i < document.styleSheets.length; ++i) {
    const { cssRules } = document.styleSheets[i];
    for (let j = 0; j < cssRules.length; ++j) rules[cssRules[j].selectorText] = cssRules[j];
  }
  return rules;
}

export function cssGetclass(name) {
  const rules = cssRules();
  if (!rules.hasOwnProperty(name)) throw "TODO: deal_with_notfound_case";
  return rules[name];
}
