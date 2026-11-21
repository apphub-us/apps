# EC-VOICE-MATERIALS-3 — material-list draft and one-question review

## Scope and boundaries

This change repairs interpretation of natural material lists, including the manually transcribed screenshot that begins `Ok, muszę teraz potrzebuję 3 kable...`. It does not change the speech-recognition model, microphone pipeline, offline speech pack, electrical calculations, code requirements, existing record schemas or purchase behavior. Recognition accuracy in Polish remains experimental; a plausible wrong transcription may still require human detection. No real microphone/field accuracy pass is claimed from text tests.

A new pure material interpreter creates a typed draft before asking questions. It separates quantity/unit from specification, groups a possible wire total and subsequent breakdown without adding them together, attaches an uncounted repeated noun as a specification continuation, and keeps interrupted counts with their material. Only an explicit set of harmless discourse markers is ignored. Unknown instructions, negation, ambiguous symbols and meaningful leftover text remain blocking. This is bounded PL/EN interpretation, not unrestricted model-based language understanding.

## Material data

Countable part names provide a count unit without requiring a special command such as `sztuki`: `2 konektory 1 1/2 cala` becomes quantity `2`, unit `pcs`, label `Konektor`, specification `1 1/2 in`. These are proposed fields, not approved electrical selections. Explicit wire counts remain counts; a stated length remains length. `2/0 AWG` is not interpreted as two pieces or a length. A separated `2 0`, bare `12` or `11 albo G` is not silently converted into an AWG size. `1, 1, 2 incia` is not silently converted into 1½ inches. No conductor material, insulation, size, length or fitting type is inferred from installation requirements.

A missing size for a typed part is a question. The user may explicitly say `rozmiar niepodany` to keep it unknown, recorded as an empty specification with an acknowledgement note. The interpreter validates against the unchanged material model. A complete group is saved only after the existing explicit confirmation; failed entries do not trigger partial automatic saving.

## Reported case

The original text produces three pending groups: wires, connectors and bushings. Repeated `2... 2...` is not multiplied into additional fittings. The first wire number and later quantities are not added into a fictitious total. The UI displays one question at a time and retains all other draft entries. A wire-group clarification may contain several explicit wire entries; a single-part clarification cannot insert a different material family or extra unrelated actions.

Clarification uses the exact source span and the existing review-generation/job guards. Replacing a group is explicit; incomplete or stale replies do not modify the draft. The original transcription and exact user replies remain in the existing batch provenance. Resulting records use the existing material schema and are included by the unchanged archive/Restore system. The separate batch audit remains outside .ecjob, as previously documented.

The review now shows specification separately from quantity before Save. `Try material list example` opens the clearly labelled synthetic DEMO job and the reported transcription example; it does not invoke the microphone or write material records. The user must supply their own confirmed values. Example values used in automated tests are synthetic and are not assertions about the user's actual desired sizes.

## Tests and delivery

New pure tests cover natural plural nouns, filler, continuation, counts vs sizes, exact gauge notation, unit ambiguity, false starts, explicit unknown size, negative/unsafe quantities, family/extra-action refusal, stale replies, generated counts, bounds and full reported-case repair. Native isolated Chrome tests cover the actual draft, question queue, explicit save, exact specifications, duplicate protection and reload. Physical iPhone and real speech accuracy remain separate tests.

Module-registry assertions increase from 37 to 38 to register the new pure helper; engine assertions are not relaxed. Deployment is limited to the existing experimental preview at port 12347, with byte-for-byte baseline backup and verified source pin. The stable 12346 copy, primary repository and personal browser databases are not edited. No network model, API key, cloud speech fallback, global dependency installation or automatic purchase is introduced.
