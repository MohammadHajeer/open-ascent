# Known limitations

## Current limitations

- **Movement coverage:** Recorded-video analysis and Live Coach currently process Vertical Pull. The movement library and workout log include broader content, but those entries do not imply video-analyzer support.
- **Video uncertainty:** Occlusion, camera angle, lighting, incomplete body framing, and grip visibility can produce partial or uncertain reps or an `unknown` variant. Optional visual classification addresses only unresolved Vertical Pull semantics; it does not replace deterministic rep detection.
- **Live Coach device behavior:** Local tests cover its analyzer, camera lifecycle, and voice scheduling, but behavior depends on the presentation device, browser, camera placement, permissions, and audio policy. Rehearse on the actual setup. A front-facing camera sees side-to-side sway but not front-to-back swing, and knee position is not assessed. The voice counts reps 1–50; later reps are still counted on screen.
- **Measured hold capability:** The current uploaded-analysis recalibration path accepts repetition movements only. Logged holds can appear in training/progress and may contribute to rules that accept them, but they are not an uploaded-video measured hold recalibration.
- **Readiness evidence:** A movement remains `UNKNOWN` when a published rule lacks acceptable, current, structured evidence. A self-reported baseline or standalone upload is not automatically enough to establish measured capability.
- **Zero-history plans:** Profile and Goal modes can offer a Quick readiness check for the published Pull-Up, Push-Up, and Dips foundation rules. A new athlete can receive a conservative starter preview when a relevant answer and equipment permit it; a known "not yet" answer permits only the guides' easier-option supporting exercises, and avoidance blocks the movement and its related supporting work. Other movements remain unavailable without their configured evidence; the check is not a substitute for training history in Progress mode.
- **Supporting exercises:** Plans may include a small curated catalog of supporting exercises (for example Tuck Front Lever Hold or Ice-Cream Maker). They have no video analysis, Live Coach support, readiness test, capability tracking, or workout logging, and hold dosages are conservative starting ranges because Open Ascent does not measure holds yet. Band-assisted variations are omitted until onboarding can record a resistance band.
- **Coach knowledge sources:** AI Coach has no web search. It explains supporting exercises only from Open Ascent's curated catalog and never cites external links. A trusted-resource lookup would be future work.
- **Progress adaptation:** Progress mode requires sets from at least two distinct self-attributed workout sessions. It uses COACH-03 points without a universal fitness score.
- **External services:** Coach responses, plan generation, analysis explanations, Stripe state, and hosted Supabase operations depend on provider availability and configuration. The demo should have completed results ready.
- **Demo measurement:** Yazan's foundation readiness comes from recent self-performed manual workouts. His initial rep estimates remain provisional, and advanced analyzer-gated variations remain `UNKNOWN` until a real qualifying upload exists.
- **Deployment:** The repository documents local development and test-mode checkout; it does not include a verified production deployment procedure or claim production validation.

## Intentional scope boundaries

- Live Coach focuses on Vertical Pull and does not classify Muscle-Up or other families. MediaPipe Pose's coarse, often occluded hand points do not reliably distinguish overhand from underhand grip, so the current pose-only camera path reports grip as unknown. It still reports supported width and height evidence with partial Vertical Pull labels. High means the upper-torso proxy reaches the wrist line; the bar itself is not detected.
- Live camera sessions are not recorded, uploaded, or automatically added to the workout log.
- Plan proposals are previews until the athlete explicitly saves them.

## Future enhancements

Expand movement/video coverage, validate Live Coach across a wider set of real devices and camera setups, and add measured hold-duration analysis. These are directions, not current capabilities.
