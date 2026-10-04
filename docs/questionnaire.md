# Backend questionnaire decision API

The questionnaire API is independent of the guided assessment UI. It does not
read or write `AssessmentSession`, history, PDF exports, or the current
assessment flow. The frontend will be wired separately.

## Pipeline

Questionnaire answers → Rust validation → deterministic age calculations →
TypeSafe Jev → validated typed profile, confidence and probabilities.

Rust computes `feltAgeDeltaYears = feltAge - chronologicalAge` and
`feltAgeDeltaRatio = feltAgeDeltaYears / chronologicalAge` using floating-point
division after range validation. Jev receives these computed values and is
explicitly instructed not to calculate them.

The result describes **subjective/self-perceived age only**. It is not
biological age, diagnosis, medical risk, or clinical assessment. These limits
are also stated in the Jev instructions.

## Tauri contract

Command: `assess_questionnaire`

Arguments (the Tauri argument is named `answers`):

```json
{
  "answers": {
    "chronologicalAge": 75,
    "appearancePerception": "little_younger",
    "feltAge": 64
  }
}
```

- `chronologicalAge`: integer, inclusive range 18–120.
- `appearancePerception`: `much_younger`, `little_younger`, `about_same`,
  `little_older`, or `much_older`.
- `feltAge`: integer, inclusive range 1–120.
- Extra answer fields are rejected. Missing fields, noninteger ages and unknown
  enum values are rejected at deserialization before any request.

Success shape (illustrative provider values, **not a live result**):

```json
{
  "features": {
    "chronologicalAge": 75,
    "appearancePerception": "little_younger",
    "feltAge": 64,
    "feltAgeDeltaYears": -11,
    "feltAgeDeltaRatio": -0.14666666666666667
  },
  "model": "jev-<provider-returned-version>",
  "profile": "younger_self_perception",
  "confidence": 0.8,
  "probabilities": {
    "younger_self_perception": 0.7,
    "age_aligned": 0.1,
    "older_self_perception": 0.05,
    "mixed": 0.15
  },
  "inputTokens": 123
}
```

Profiles:

| Profile | Meaning |
| --- | --- |
| `younger_self_perception` | Answers overall indicate feeling/looking younger than chronological age. |
| `age_aligned` | Answers broadly align with chronological age. |
| `older_self_perception` | Answers overall indicate feeling/looking older than chronological age. |
| `mixed` | Appearance and felt-age answers conflict or are not coherently represented by the other categories. |

`model` is the actual provider-returned name; the requested alias is always
`jev-latest`. The client calls `POST https://api.typesafe.ai/v1/systemone` with
Bearer authentication, a structured `state` containing only the five features,
and one typed `choice` question named `profile`, with the four criteria above.
The wire format follows [TypeSafe's official API reference](https://docs.typesafe.ai/api).

Validation requires a `choice` answer, an allowed profile, finite confidence in
0–1, exactly the four probability keys, finite probabilities in 0–1, a sum
within absolute tolerance `0.000001` of 1, and a selected profile whose
probability is maximal. Ties are allowed. Values are neither normalized nor
replaced. The response also requires a nonempty model name and nonnegative
integer `usage.input_tokens`.

Application errors serialize as `{ "code": "...", "message": "..." }`:
`invalid_input`, `missing_api_key`, `keychain_error`, `transport_error`,
`provider_error`, or `invalid_response`. Tauri argument deserialization errors
use Tauri's own error format. Provider errors include only HTTP status, never
response bodies, credentials, or raw transport/deserialization errors. Requests
have a 10-second connect timeout and a 30-second total timeout; redirects are
disabled. There are no automatic retries or local decision fallback.

## Credentials for later configuration

No real API key or working default is shipped. For local development, replace
this placeholder **in your environment**, not in frontend code:

```sh
export TYPESAFE_API_KEY='<your-typesafe-api-key>'
```

Credentials are resolved and used entirely in Rust. The keychain uses service
`com.elderwise.app`, account `typesafe-api-key`. A nonempty keychain credential
wins over `TYPESAFE_API_KEY`. The environment fallback also works if the local
keychain service is unavailable. If neither source contains a key, assessment
returns `missing_api_key`; an inaccessible keychain without an environment
fallback returns `keychain_error`.

Future frontend configuration can invoke:

| Command | Arguments | Success |
| --- | --- | --- |
| `questionnaire_set_key` | `{ "key": "<your-typesafe-api-key>" }` | `null`; stores the trimmed key in the keychain; rejects empty keys. |
| `questionnaire_clear_key` | `{}` | `null`; removes the keychain entry; an absent entry is success. |
| `questionnaire_key_status` | `{}` | `{ "configured": true, "source": "keychain" }`, `{ "configured": true, "source": "environment" }`, or `{ "configured": false, "source": null }`. |

Clearing the keychain does not unset the process environment. Status never
returns the credential. No questionnaire command logs keys or sends them back
to the frontend. Existing AI credential providers and settings are unchanged.

## Verification

Rust tests cover all appearance values, age validation, deterministic deltas
and ratios, request isolation, every allowed profile, response validation,
credential selection/missing keys, and a local HTTP server that checks the
Bearer request contract and safe provider errors. No live key is required.
Live provider verification is deferred until a key is configured.
