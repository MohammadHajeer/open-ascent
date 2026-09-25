# Known limitations

## Current limitations

- **Movement coverage:** Recorded-video analysis and Live Coach currently process Vertical Pull. The movement library and workout log include broader content, but those entries do not imply video-analyzer support.
- **Video uncertainty:** Occlusion, camera angle, lighting, incomplete body framing, and grip visibility can produce partial or uncertain reps or an `unknown` variant. Optional visual classification addresses only unresolved Vertical Pull semantics; it does not replace deterministic rep detection.
- **Live Coach device behavior:** Local tests cover its analyzer and camera lifecycle, but behavior depends on the presentation device, browser, camera placement, permissions, and audio policy. Rehearse on the actual setup.
- **Measured hold capability:** The current uploaded-analysis recalibration path accepts repetition movements only. Logged holds can appear in training/progress and may contribute to rules that accept them, but they are not an uploaded-video measured hold recalibration.
- **Readiness evidence:** A movement remains `UNKNOWN` when a published rule lacks acceptable, current, structured evidence. A self-reported baseline or standalone upload is not automatically enough to establish measured capability.
- **Zero-history plans:** Profile and Goal modes can offer a Quick readiness check for the published Pull-Up, Push-Up, and Dips foundation rules. A new athlete can receive a conservative starter preview when a relevant answer and equipment permit at least one movement. An inability or avoidance answer blocks that movement. Other movements remain unavailable without their configured evidence; the check is not a substitute for training history in Progress mode.
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
