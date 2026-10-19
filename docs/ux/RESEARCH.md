# Research: prompt 2 output

Prompt: [AGENT-PROMPTS.md](AGENT-PROMPTS.md) §2, Researcher, with the shared assignment contract. Process step: UX-02, planning only. Date: 2026-10-19. **No participant research ran.** This document summarizes published sources and proposes the next study.

How this was done: web search on 2026-10-19, reading abstracts, publisher pages and official policy documents. Where only an abstract or a secondary summary was reachable, the row says so. Exact figures from secondary summaries are not quoted.

## Decision questions

1. **Access support:** when does reading aloud, or a spoken answer, change what a task measures? (WF-03-A, round 1 open decision D7)
2. **Early readers:** how much should one screen ask of a 5–7-year-old? (WF-03, WF-04, round 1 step 6)
3. **Healthy finishing:** does a planned end help young children stop well? (Scorecard panel 5, round 1 step 6)
4. **Children's understanding of AI:** what do children believe about an AI tutor's knowledge and reliability? (Process UX-08: "ask children what the AI is and whether it can be wrong"; FRAMEWORK clear AI identity)
5. **Delayed checks:** are 7- and 28-day checks a sound design? (WF-06-A)

## Evidence table

| # | Source (primary unless noted) | Participants and context | Finding (as reported) | Limits | Product inference |
|---|---|---|---|---|---|
| 1a | Buzick & Stone (2014), *A meta-analysis of research on the read aloud accommodation*, Educational Measurement: Issues and Practice 33(3). [ETS record](https://www.ets.org/research/policy_research_reports/publications/article/2014/jtbv.html) | Pooled K–12 studies, students with and without disabilities | Read-aloud raised reading-test scores by about 0.56 SD on average, and maths scores by about 0.13 SD. | Read from the abstract only. Test accommodations, not learning tasks. A published comment debates its interpretation against Li (2014), which was not reached. | Reading aloud changes reading scores much more than maths scores. In a reading check it is likely to change what is measured. |
| 1b | NAEP inclusion policy, National Center for Education Statistics. [Accommodations table](https://nces.ed.gov/nationsreportcard/about/accom_table.aspx); state copies of the NAEP inclusion policy, e.g. [DC OSSE 2019](https://osse.dc.gov/sites/default/files/dc/sites/osse/publication/attachments/NAEP%202019%20Inclusion%20Policy-For%20SD-Grade%2012.pdf) | US national assessment policy | Reading passages and items may not be read aloud, only instructions, because decoding is part of what NAEP reading measures. | A policy for a summative test, not research on learning. | A precedent for the rule "read the instructions, not the tested text" in reading and decoding checks. In maths, reading the question aloud does not supply the maths. |
| 2a | Woodward et al. (2016), *Characterizing how interface complexity affects children's touchscreen interactions*, CHI. [Paper](https://init.cise.ufl.edu/wp-content/uploads/sites/378/2017/05/Woodward-et-al-CHI2016_0.pdf) | 30 children aged 5–10 and 30 adults | Interface complexity changed some touch behaviour, mostly through visual salience; gesture recognition was not affected. | Touch performance only; not comprehension or learning. | Supports fewer competing targets on young children's screens. Not direct evidence for "one decision at a time". |
| 2b | W3C, *Making content usable for people with cognitive and learning disabilities* (COGA). [Summary](https://www.w3.org/TR/coga-usable/summary.html) | Standards guidance | Clear structure, help with mistakes and a low memory burden, tested with real users. | Guidance, not a child study. | Matches the early-reader changes: one line of feedback, Hear this, a default photo form. Child testing is still required (M7). |
| 3 | Hiniker et al. (2017), *Plan & Play: supporting intentional media use in early childhood*, IDC. [Paper](https://faculty.washington.edu/alexisr/PlanAndPlay.pdf) | Lab study, 11 parent–preschooler pairs | Children planned goal-directed play. When playing through their own plan, they moved to the next activity without help 93% of the time. | Small lab sample, preschool age, media play rather than tutoring. | Supports a visible, planned end to a mission and "Done for today" as the main action. M7 measures endings as scorecard panel 5. |
| 4a | Druga, Williams, Breazeal & Resnick (2017), *"Hey Google is it OK if I eat you?" Initial explorations in child-agent interaction*, IDC, doi:10.1145/3078072.3084330. [Paper](https://robots.media.mit.edu/wp-content/uploads/sites/7/2017/06/idcwp0180-drugaACR.pdf) | 26 children aged 3–10 with four agents | Themes: perceived intelligence, identity attribution, playfulness and understanding. The way children interacted with an agent changed how they compared its intelligence with their own. | Exploratory and small; voice assistants and robots, not tutors. | Children form varied beliefs about AI. The tutor should say plainly what it is and that it can be wrong. The new "I think there's a mistake" button gives them a way to act on that. |
| 4b | Girouard-Hallam & Danovitch (2022), *Children's trust in and learning from voice assistants*, Developmental Psychology 58(4), 646–661, doi:10.1037/dev0001318 | Children (details not reached) | **Not verified:** only the citation was reached. A related conference abstract from the same lab reports age differences in what children trust a voice assistant for. | The findings must be read before anyone relies on them. | Open: check before writing child-facing copy about the AI. |
| 5a | Cepeda, Vul, Rohrer, Wixted & Pashler (2008), *Spacing effects in learning: a temporal ridgeline of optimal retention*, Psychological Science 19(11), 1095–1102. [PubMed](https://pubmed.ncbi.nlm.nih.gov/19076480/) | More than 1,350 participants, final test up to a year later | The best gap between study sessions grows with the test delay but shrinks as a share of it: about 20–40% of a 1-week delay, falling to about 5–10% of a 1-year delay. | Facts learned by mostly adult online participants. Transfer to children and to maths procedures is an inference. | Checks at 7 and 28 days are reasonable spacing points. Their purpose is to measure retention, not to tune the schedule. |
| 5b | Roediger & Karpicke (2006), *Test-enhanced learning*, Psychological Science 17(3), 249–255, doi:10.1111/j.1467-9280.2006.01693.x | Undergraduates, prose passages | Retrieval tests beat restudy after a delay, though not immediately. | Adults. Exact percentages differ between secondary summaries and are not quoted here. | Supports fresh retrieval checks, the "fair checks", as the evidence and learning activity. Adult-to-child transfer is flagged. |

## What the evidence supports, and what it does not

- **Supports:**
  - Treating read-aloud differently for reading and decoding checks than for maths (1a, 1b).
  - Keeping young children's screens sparse (2a, 2b).
  - A planned, visible finish (3).
  - Saying plainly what the AI is (4a).
  - Spaced retrieval checks (5a, 5b).
- **Does not support:**
  - Any claim that these changes improve learning or usability for our children. That needs observation (M7).
  - Any specific threshold for "too much on one screen".
  - Any effect size for our product.
- **Conflicts and gaps:**
  - The read-aloud literature disagrees about whether the accommodation changes the measured construct (1a and its published comment).
  - Most retention evidence comes from adults (5a, 5b).
  - 4b is unread.

## Proposed rule for the open access-support decision (owner decision, not applied)

| Task's measured skill | Reading the question aloud | Spoken answer |
|---|---|---|
| Maths, science, reasoning | Access support. Independence is unchanged (current behaviour). | Access support. Independence is unchanged (current behaviour). |
| Reading comprehension or decoding | Reading the instructions is access. Reading the tested text supplies the skill, so the attempt counts as supported. | Access support. |
| Spelling | Access support. | Supplies the skill (the speech engine spells it), so the attempt counts as supported. |

To apply this, each concept needs a "measured skill" tag. Built-in maths is unaffected; it would matter for custom reading and spelling subjects. It is recorded here for the owner's decision. No code changes until the owner agrees.

## Next study (proposal; not run)

**Question:** can 5–7-year-olds finish a mission, recover from a miss and stop, without adult help with the interface?

- **Who:** our own children, with the parent as facilitator, using [FAMILY-SESSION-KIT.md](FAMILY-SESSION-KIT.md). Later rounds could add families who volunteer.
- **Consent and assent:** the parent decides; the child is told it is not a test and can stop at any time. No recording by default. Sheets stay outside the repository.
- **Tasks:** C1–C8 in the kit. Ask C9 at the end: "What is the tutor? Can it be wrong?" (question 4).
- **Stop rules:** the child asks to stop, shows distress, or is stuck for three minutes on one screen. A technical failure is logged, not counted as a child failure.
- **Measures:** scorecard panels 1 (interface independence), 3 (parent clarity) and 5 (healthy completion), with counts and denominators. Navigation help is counted separately from teaching help.
- **What it can show:** specific failures and confusions on our devices. **What it cannot show:** that the design works for children in general, or any learning effect.
