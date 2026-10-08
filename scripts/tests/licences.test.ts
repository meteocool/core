import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { group, splitCopyright } from "../licences.mjs";

const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software, to deal in the Software without restriction.`;

test("the copyright lines at the top of a licence come off it, titles dropped", () => {
  const { copyright, body } = splitCopyright(`MIT License\n\nCopyright (c) 2020 Someone\nAll rights reserved.\n\n${MIT}\n`);
  assert.deepEqual(copyright, ["Copyright (c) 2020 Someone All rights reserved."]);
  assert.equal(body, MIT);
});

test("a copyright line running on into the licence stays in it", () => {
  // Py-ART's second copyright line is the start of a paragraph.
  const text = "Copyright (c) 2013, UChicago Argonne, LLC\nAll rights reserved.\n\n"
    + "Copyright 2013 UChicago Argonne, LLC. This software was produced under U.S.\nGovernment contract.";
  const { copyright, body } = splitCopyright(text);
  assert.deepEqual(copyright, ["Copyright (c) 2013, UChicago Argonne, LLC All rights reserved."]);
  assert.ok(body.startsWith("Copyright 2013 UChicago Argonne, LLC. This software"));
});

test("copyright lines further down, as in MapLibre's licence, stay where they are", () => {
  const text = `Copyright (c) 2023, MapLibre contributors\n\n${MIT}\n\nContains code from earcut\n\nCopyright (c) 2016, Mapbox\n\n${MIT}`;
  const { copyright, body } = splitCopyright(text);
  assert.deepEqual(copyright, ["Copyright (c) 2023, MapLibre contributors"]);
  assert.ok(body.includes("Copyright (c) 2016, Mapbox"));
});

test("licences that differ only in copyright and wrapping share one text, keeping every copyright", () => {
  const groups = group([
    { name: "b", version: "1.0.0", license: "MIT", text: `Copyright (c) 2020 B\n\n${MIT}` },
    { name: "a", version: "2.0.0", license: "MIT", text: `The MIT License (MIT)\n\nCopyright (c) 2021 A\n\n${MIT.replace("\n", " ")}` },
    { name: "c", version: "1.0.0", license: "ISC", text: "Copyright (c) 2022 C\n\nPermission to use, copy, modify." },
  ]);
  assert.equal(groups.length, 2);
  const [mit] = groups;
  assert.equal(mit.name, "a, b");
  assert.equal(mit.version, "2.0.0, 1.0.0");
  assert.equal(mit.copyright, "Copyright (c) 2021 A\nCopyright (c) 2020 B");
  assert.deepEqual(mit.packages, [
    { name: "a", version: "2.0.0", copyright: "Copyright (c) 2021 A" },
    { name: "b", version: "1.0.0", copyright: "Copyright (c) 2020 B" },
  ]);
});

test("the imprint lists every package in the generated JSON", () => {
  const imprint = readFileSync(new URL("../../imprint.html", import.meta.url), "utf8");
  const software = imprint.slice(imprint.indexOf("id=\"software\""));
  const groups = JSON.parse(readFileSync(new URL("../../public/third-party-licences.json", import.meta.url), "utf8"));
  for (const { packages } of groups) {
    for (const { name, version } of packages) {
      const label = (version ? `${name} ${version}` : name).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      assert.ok(software.includes(label), `imprint.html#software lacks ${label}; rerun npm run licences`);
    }
  }
});
