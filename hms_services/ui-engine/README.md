# HMS UI Engine

This directory is the target home for the Python declarative UI authoring pipeline and Go runtime integration. It is distinct from the existing domain/business DSL under `dsl/`.

Pipeline: trusted Python definitions -> compiler -> typed/versioned UI IR -> independent Go validation -> authorized data-source resolution and registered action execution -> React renderer.

Do not execute arbitrary Python in production requests or in the browser. Follow `standards/contracts/ui-ir-contract.md` and `standards/architecture/declarative-ui-engine.md`.
