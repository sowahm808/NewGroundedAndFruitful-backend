# Bible quiz DOCX import format (parser `gf-bible-ooxml/2.0.0`)

Upload one child-facing question document and one answer-key document. Each file is limited
to 5 MiB. Imports always create a `needs_review` draft; publishing requires a separate
validated commit.

## Supported structure

- Begin each month with `Month of July` (using the applicable month).
- Begin each daily activity with a literal heading such as
  `1- Ezekiel 33:7 “Watchman”`.
- Put each prompt in its own paragraph. Prompts may be unnumbered, use literal decimal
  numbering (`1.`, `1)`, or `1-`), or Word automatic decimal numbering.
- Put each choice in its own paragraph, labelled `a.` through `e.` (parentheses and hyphens
  are also accepted). At least two and no more than five choices are supported.
- The answer key must have the same activities, question order/numbers, prompts, labels,
  and choice content. Underline exactly the answer text for one choice per question. Visible
  direct underlines and underlines inherited from a character style are supported; an
  explicit underline value of `none` is never a mark.
- Paragraph layouts and paragraphs inside tables are supported. Do not place multiple
  questions or multiple choices in one paragraph.

Unicode composition, straight/smart quotes, nonbreaking spaces, repeated whitespace, tabs,
line breaks, case, and terminal choice punctuation are treated as presentation differences.
Words, numbers, negation, Bible references, prompt punctuation, choice labels, and internal
choice punctuation must agree. Ambiguous or missing correct-answer formatting always blocks
the import rather than producing a warning.
