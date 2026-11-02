# Local JavaScript inference

`schema-inference.js` adapts the relative-selector and per-record field inference
from html-to-schema (`src/html_to_schema/inference.py`), revision
`d116f503783d4339ae46a40312b28621f7ace021`:
https://github.com/python-web-scraping-com/html-to-schema

Upstream copyright and MIT license: `third-party/html-to-schema.LICENSE`.
This is a subset adapted to the browser DOM, not a full Python package port.
No Python service, external model, or network request is required at runtime.

The existing pagecode candidate detector and ranking remain in use. Both
automatic detection and resolving a clicked selection use this module to infer
fields. Stable itemprop / role attributes and classes precede structural CSS;
selectors are checked across up to 12 records spread over the list. In contrast
to upstream's first-record template, the local implementation unions fields
from these samples to find optional fields. Missing fields have no index
fallback, preserving empty cells instead of substituting neighboring fields.
Lazy image URLs, content attributes, and textless links are supported.
Rules remain plain JSON compatible with the existing preview/execution paths.

Limitations: fields absent from all sampled records cannot be inferred. Purely
positional, unlabelled repeated elements remain ambiguous when their structure
changes. Canvas, closed shadow DOM and cross-origin frames are not covered.
AutoScraper, Scrapling, detail-page JSON-LD and Python code generation are not
ported by this module. Old saved rules keep their original selectors until the
user runs recognition and saves again.

Regression: `electron test/schema-inference.cjs`, `electron test/detect-scroll.cjs`,
`electron test/multi-recognition.cjs`.
