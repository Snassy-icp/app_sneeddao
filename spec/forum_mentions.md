# Forum @-mentions

Written 2026-10-18. Members write "@" and pick a name in a forum thread or post; the person
mentioned is told. Mr Sneed reads his mentions the same way, so members can call him into a
discussion.

## The mention

A Markdown link whose text starts with "@" and whose target is a principal page:

```
[@Mr Sneed](https://app.sneeddao.com/principal?id=tksci-…-aae)
```

- **The principal is who is meant.** Names are unique only up to case ("Mr Sneed", "Mr_Sneed"
  and "mr-sneed" can belong to three people), so typed text alone can't say who was meant.
- **The name is how it reads.** Names may contain spaces, and Sneed Hub shows the current name
  and links the member's page, so a rename never breaks a mention.
- **Every client shows a working link**, including TACO DAO's forum view and raw API reads.
- The relative form `/principal?id=…` counts too.
- **Ignored:** plain "@name" text, link text over 64 characters, other hosts, and principals that
  are malformed or not in canonical lowercase form (checked without trapping:
  `Mentions.principalOfText`).

## The editor

`components/MentionTextarea.jsx` replaces the textarea in every thread and post editor (topic
page, thread view, proposal discussions, feedback):

- typing "@" and part of a name lists matching members (public names, plus private nicknames
  as a search aid);
- picking one inserts the link with the **public** name, or a short principal when there is
  none, so private nicknames never leak into posts.

## The forum (sneed_sns_forum, additive)

When `create_thread`, `create_post`, `update_thread` or `update_post` succeeds, the forum records
the mentions in the text:

- at most 10 per text;
- no self-mentions;
- each person once per thread text or post;
- an edit records only people it adds.

New methods:

| Method | Does |
|---|---|
| `get_mentions_of_user(user, before, limit)` | newest first, paged by index, at most 100; deleted threads and posts drop out |
| `get_recent_mentions_count(user)` | since the user last marked them seen |
| `mark_mentions_seen_up_to(ts)` / `get_last_seen_mentions_timestamp(user)` | as for replies |
| `set_mention_sms(bool)` / `get_mention_sms(user)` / `get_mention_sms_opted_in(users)` | the SMS opt-in |

All new state is in new stable variables, and the queries join the ingress guard's refused list.

## Notifications

- **Header:** a pink "@ n" chip next to replies, under the same "Reply Notifications" setting. It
  links to the new **Mentions** tab on `/posts`; opening the tab marks mentions seen.
- **SMS (opt-in, "SMS When Mentioned" on /me):**
  - after a save, the poster's browser asks the forum which newly mentioned members opted in;
  - it sends them one Sneed SMS from the poster's own principal (excerpt plus link);
  - SMS rate limits apply as usual, the forum pays no cycles, and recipients can reply to the
    poster.
- **Mr Sneed:** each session starts by reading `get_mentions_of_user(tksci…)` and answers in the
  thread. Once he runs on-chain, his timer reads the same method.

## Later

Mentions in SMS messages, using the same parser.
