# Reddit Data API access — request draft (personal, non-commercial)

Reddit reviews requests for API access under its Responsible Builder Policy. Approval is not guaranteed.
Submit from your own Reddit account. Reddit's current form and terms are linked from
https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy and
https://redditinc.com/policies/data-api-terms. Adjust any wording to match the form's questions.

---

**App name:** GTA VI Strategy HQ (personal)

**Type of use:** Personal, non-commercial. A private dashboard used by one person. No ads, no resale, no public access.

**What it does:** Once every three hours, it reads the newest posts from a few public GTA VI communities
(r/GTA6, r/GTAVI, r/GrandTheftAutoVI, r/GTA6unmoderated, r/gtaglitches, r/grandtheftauto, r/rockstar). It turns practical gameplay
tips (vehicle locations, money spots, weapon pickups) into short notes in my own words for my own play-through,
each with a link back to the original Reddit post.

**Data handling:**
- Reads public posts only, through the official OAuth API with a descriptive User-Agent. No scraping, no private messages, no user profiles.
- Stores only the post link, title, a short excerpt (under 300 characters) and a paraphrased note. Full post text is never stored.
- Keeps a poster's username only to tell independent reports apart; no other profile data.
- Does not use Reddit data to train AI models. A language model reads one post at a time to write the short note.
- Respects rate limits (about 14 requests every 3 hours) and Reddit's spoiler and NSFW flags.

**Volume:** About 100 API requests per day.

**Contact:** (your Reddit username / email)

---

After approval, create a "script" app at https://www.reddit.com/prefs/apps and add to the hosted app's settings:
`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` (e.g. `web:gta6-strategy-hq:v1 (by /u/yourname)`),
then turn on `reddit_ingestion` in Admin → Feature flags.
