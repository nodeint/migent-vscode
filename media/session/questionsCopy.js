// Copy of the Questions tab: every label, note and message the tab shows, in one place. Loaded before `questions.js`
// (see docs/ui.md). Exposes one global, `MigentSessionQuestionsCopy`. A text with a value in it is a function.
// Text that several pages show lives in `MigentCopy` (the View log button is `MigentCopy.menu.viewLog`).
(function () {
  'use strict';

  window.MigentSessionQuestionsCopy = {
    /** The chip on each question card. */
    state: { sent: 'Sent', answered: 'Answered', notAnswered: 'Not answered' },

    /** The attempt selector at the left of the bar above the questions. */
    attempts: {
      label: 'Attempt',
      roleSession: 'Role session',
      option: (stage, attempt) => stage + (attempt === null ? '' : ' - attempt ' + attempt),
    },

    /** The jump chips above the questions. */
    jumps: {
      label: 'Questions',
      goTo: (id, isAnswered) => 'Go to question ' + id + (isAnswered ? ' (answered)' : ' (not answered)'),
    },

    question: {
      eyebrow: (id, total, isSingle) =>
        'Question ' + id + ' of ' + total + ' · ' + (isSingle ? 'Pick one' : 'Pick one or more'),
      recommended: 'Recommended',
      showMore: 'Show more',
      showLess: 'Show less',
      other: 'Other',
      otherHint: 'write your own answer',
      placeholder: 'Type your own answer',
      answerLabel: (id) => 'Your answer to question ' + id,
      ambiguous: 'This answer is just an option letter, so it will be read as that option. Add a word to make it your own answer.',
      recorded: 'Recorded',
    },

    archived: {
      title: 'Your previous draft (read-only)',
      line: (id, question, answer) => id + '. ' + question + ' — ' + (answer || 'no answer'),
    },

    footer: {
      reload: 'Load the new questions',
      recheck: 'Check again',
      continue: 'Continue the stage',
      discard: 'Discard draft',
      send: 'Send answers',
      sendLeft: (left) => 'Send answers · ' + left + ' left',
      sending: 'Sending…',
    },
  };
})();
