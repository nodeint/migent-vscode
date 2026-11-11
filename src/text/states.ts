interface Detail {
  detail: string;
}
interface Reason {
  reason: string;
}

/** Sentences of describers, blocking reasons, validation and page-state messages. */
export const STATES = {
  // Write eligibility
  'states.cliChecking': () => 'The Migent CLI is still being checked.',
  'states.cliUnavailable': ({ kind }: { kind: string }) => `The Migent CLI is unavailable (${kind}).`,
  'states.foreignLock': ({ owner, beat }: { owner: string; beat: string }) =>
    `Another process holds this session (${owner}${beat}).`,
  'states.lockOwnerPid': ({ pid }: { pid: number }) => `pid ${pid}`,
  'states.lockOwnerUnknown': () => 'unknown',
  'states.lockHeartbeat': ({ at }: { at: string }) => `, last heartbeat ${at}`,
  'states.busy': ({ phase }: { phase: string }) => `Another operation on this session is still running (${phase}).`,
  'states.phaseStarting': () => 'starting',
  'states.phaseRunning': () => 'running',
  'states.phaseSendingReply': () => 'sending reply',
  'states.phaseRepairing': () => 'repairing',
  'states.phaseCompleting': () => 'completing',
  'states.phaseStopping': () => 'stopping',
  'states.phaseDeleting': () => 'deleting',

  // Client quota; the reset phrase is computed by the producer
  'states.noResetTime': () => 'no reset time was recorded',
  'states.resetsAt': ({ when }: { when: string }) => `resets ${when}`,
  'states.quotaFailed': ({ reset }: { reset: string }) => `Failed on client quota; ${reset}`,

  // Failure text
  'states.preflightFailed': () => "Migent's pre-run check failed. The log lists the problems; fix them and run again.",
  'states.exitCode': ({ code }: { code: number }) => `Migent exited with code ${code}.`,
  'states.exitCodeUnknown': () => 'Migent exited with code unknown.',
  'states.configError': () => 'Migent reported a configuration error.',
  'states.draftRejected': ({ last }: { last: string }) => `Migent rejected this session's workflow.yaml. ${last}`,
  'states.checkDraft': ({ neutral }: { neutral: string }) => `${neutral} Check this session's workflow.yaml and the log.`,
  'states.appendLast': ({ text, last }: { text: string; last: string }) => `${text} ${last}`,

  // Answer batch state
  'states.answersSent': () => 'Answers sent. The stage is continuing.',
  'states.answersSaved': () => 'Answers saved, but the stage has not continued yet.',
  'states.answeredElsewhere': () => 'These questions were already answered. The answers are shown below.',
  'states.noLongerWaiting': () => 'These questions are no longer waiting for an answer.',
  'states.questionsChangedKept': () =>
    'The questions have changed since you opened this page. Your draft is kept for reference.',
  'states.questionsChanged': () => 'The questions have changed since you opened this page.',
  'states.historyMissing': () => 'No structured question history (questions.json) is available for this session.',
  'states.historyUnreadable': () => 'questions.json could not be read.',
  'states.historyInvalid': () => 'questions.json is malformed.',
  'states.historyUnsupported': () => 'questions.json uses an unsupported schema version.',
  'states.historyUnusable': () => 'questions.json is unusable.',
  'states.malformedRecord': ({ reason }: Reason) => `questions.json has a malformed record (${reason}).`,
  'states.filesDisagree': () => 'The session files disagree about these questions, so they cannot be answered safely.',
  'states.notForPerson': () => 'These questions are not meant for a person, so they cannot be answered here.',
  'states.noPending': () => 'There are no pending questions.',
  'states.cannotSendTogether': ({ detail }: Detail) => `These questions cannot be sent together (${detail}).`,
  'states.unsupportedMode': ({ questionId }: { questionId: string }) =>
    `Question ${questionId} has an unsupported selection mode.`,
  'states.badOptions': ({ questionId }: { questionId: string }) =>
    `Question ${questionId} does not have 2-26 distinct options.`,
  'states.duplicateQuestion': ({ questionId }: { questionId: string }) =>
    `Question ${questionId} appears twice in the batch.`,
  'states.mixedStages': () => 'questions belong to different stages or executions',
  'states.noExecution': () => 'a question has no execution',

  // Next step
  'states.nextMissing': () => 'next.json was not found.',
  'states.nextUnusable': () => 'next.json is unreadable, invalid or unsupported.',
  'states.notSuggested': ({ workflow }: { workflow: string }) => `${workflow} is not a suggestion of this session.`,
  'states.downstreamUnreadable': () => 'The downstream declaration of this session could not be read.',
  'states.notDeclared': ({ workflow }: { workflow: string }) => `${workflow} is not declared by the session's workflow.`,
  'states.targetDuplicate': () => 'More than one workflow file has this id.',
  'states.targetInvalid': () => 'The target workflow file is invalid.',
  'states.targetNotFound': () => 'No workflow with this id in the project.',
  'states.sourceNotLoaded': () => 'The source session is not loaded.',
  'states.sourceNotCompleted': () => 'The source session is not completed.',
  'states.suggestionGone': () => 'The suggestion is no longer available.',
  'states.enterTask': () => 'Enter a task.',

  // Validation
  'states.titleSingleLine': () => 'The title must be a single line.',
  'states.titleEmpty': () => 'The title must not be empty.',
  'states.enterWorkflowId': () => 'Enter a workflow id.',
  'states.workflowIdChars': () => 'Use letters, digits, "-" and "_", starting with a letter or digit.',
  'states.agentNameRequired': () => 'Every agent needs a name.',
  'states.roleNameRequired': () => 'Every role needs a name.',
  'states.agentNameRepeated': ({ name }: { name: string }) => `The agent name "${name}" is used more than once.`,
  'states.roleNameRepeated': ({ name }: { name: string }) => `The role name "${name}" is used more than once.`,

  // Reply editor
  'states.replyPromptCancelled': ({ stage, attempt }: { stage: string; attempt: number }) =>
    `Reply to the interrupted stage ${stage} (attempt ${attempt}). The workflow keeps running after the reply.`,
  'states.replyPromptRole': ({ role, executionId }: { role: string; executionId: string }) =>
    `Reply to role ${role} (execution ${executionId}). It starts a new turn.`,
  'states.replyPromptRoleUnnamed': ({ executionId }: { executionId: string }) =>
    `Reply to the role (execution ${executionId}). It starts a new turn.`,
  'states.replyPromptBlocked': ({ stage, attempt }: { stage: string; attempt: number }) =>
    `Reply to the blocked stage ${stage} (attempt ${attempt}).`,
  'states.replyInterrupted': ({ stage, attempt }: { stage: string; attempt: number }) =>
    `<!-- Interrupted stage: ${stage} (attempt ${attempt}) -->`,
  'states.replyKeepsRunning': () => '<!-- The workflow keeps running after this reply. -->',
  'states.replyRole': ({ stage, executionId }: { stage: string; executionId: string }) =>
    `<!-- Role: ${stage} (execution ${executionId}) -->`,
  'states.replyBlocked': ({ stage, attempt }: { stage: string; attempt: number }) =>
    `<!-- Blocked stage: ${stage} (attempt ${attempt}) -->`,
  'states.replyBlocker': ({ blocker }: { blocker: string }) => `<!-- Blocker: ${blocker} -->`,
  'states.replyBlockerUnavailable': () => '<!-- Blocker: unavailable -->',
  'states.replyPrevious': ({ path }: { path: string }) => `<!-- Previous response: ${path} -->`,
  'states.replyWrite': () => '<!-- Write your reply below this block, then use Send Reply. -->',

  // CLI capability
  'states.cliMissing': () => 'Migent CLI not found',
  'states.cliInstallHint': () =>
    'Install it with "npm install -g @nodeint/migent", then restart VS Code if it was installed just now.',
  'states.cliUnsupported': () => 'Migent CLI launcher is not supported',
  'states.cliOld': ({ detected, required }: { detected: string; required: string }) =>
    `Migent CLI ${detected} is older than ${required}`,
  'states.cliOldUnknown': ({ required }: { required: string }) => `Migent CLI is older than ${required}`,
  'states.cliUnparsable': () => 'Migent CLI version not recognized',
  'states.cliError': () => 'Migent CLI could not be run',
  'states.cliDetected': ({ version }: { version: string }) => `Detected version: ${version}`,
  'states.cliRequired': ({ version }: { version: string }) => `Required version: ${version} or newer`,
  'states.cliExecutable': ({ path }: { path: string }) => `Executable: ${path}`,
  'states.cliSessionsVisible': () => 'Sessions on disk stay visible. Use the Recheck action after fixing it.',
  'states.cliReady': ({ detected }: { detected: string }) => `Migent CLI ${detected} is ready.`,
  'states.cliReadyUnknown': () => 'Migent CLI is ready.',
  'states.cliInstallFailed': () => 'Install failed. See the "Migent: Install CLI" terminal.',
  'states.cliRestart': () =>
    'The install finished, but VS Code still cannot use the Migent CLI. Your shell may resolve a different "migent" ' +
    'than VS Code does (PATH, nvm, or another package manager). Restart VS Code, then use Recheck.',
  'states.cliNotOnPath': ({ command }: { command: string }) => `"${command}" was not found on PATH.`,
  'states.cliVersionFailed': ({ detail }: Detail) => `"--version" failed: ${detail}`,
  'states.cliNoVersion': ({ excerpt }: { excerpt: string }) => `No version found in: ${excerpt}`,
  'states.cliTimeout': ({ ms }: { ms: number }) => `Timed out after ${ms} ms.`,
  'states.cliNotJson': ({ detail }: Detail) => `Output is not JSON: ${detail}`,

  // Workflow editor validation
  'states.artifactRepeated': ({ id }: { id: string }) =>
    `The artifact id "${id}" is used more than once. Give each artifact its own id.`,
  'states.localArtifactRepeated': ({ value, stage, id }: { value: string; stage: string; id: string }) =>
    `Decision "${value}" of stage "${stage}" defines the artifact id "${id}" more than once.`,

  // CLI location
  'states.cliUnknownType': ({ path }: { path: string }) =>
    `${path} is neither a native executable (.exe) nor an npm launcher (.cmd).`,
  'states.cliShimEntryMissing': ({ path, extension }: { path: string; extension: string }) =>
    `${path} is a ${extension} launcher whose JavaScript entry could not be found in it. Reinstall with "npm install -g @nodeint/migent".`,
  'states.cliNodeMissing': ({ entry }: { entry: string }) =>
    `${entry} is a JavaScript entry but "node" was not found on PATH.`,

  // Files and saves
  'states.configNotMapping': ({ file }: { file: string }) => `${file} must be a YAML mapping`,
  'states.configNotCreated': () => 'config.yaml is not created from the page. Run `migent init` first.',
  'states.problemsFound': ({ count }: { count: number }) =>
    `${count} problem${count === 1 ? '' : 's'} found. Fix them and save again.`,
  'states.schemaMissing': () => 'schema_version is missing',
  'states.schemaVersion': ({ version }: { version: string }) => `schema_version ${version}`,

  // Question record problems
  'states.optionsNotList': () => 'options is not a list',
  'states.optionsCount': () => 'options must number 2-26',
  'states.optionIncomplete': () => 'an option has no id or label',
  'states.missingContext': () => 'missing context',
  'states.unsupportedSelection': () => 'unsupported selection',
  'states.unrecognizedStatus': () => 'unrecognized status',
  'states.notObject': () => 'not an object',
  'states.missingIdOrQuestion': () => 'missing id or question',

  // Diagnostics for unreadable or malformed files
  'states.handoffNotMapping': () => 'handoff is not a mapping',
  'states.handoffSourceMissing': () => 'source_session_id is missing',
  'states.handoffArtifactsNotMapping': () => 'artifacts is not a mapping',
  'states.handoffArtifactIncomplete': ({ name }: { name: string }) => `artifact ${name} lacks output, path or sha256`,
  'states.unparsableJson': () => 'unparsable JSON',
  'states.unparsableYaml': () => 'unparsable YAML',
  'states.nextNotList': () => 'next is not a list',
  'states.downstreamNotList': () => 'downstream is not a list',
  'states.totalsNotObject': () => 'totals is not an object',
  'states.stagesNotObject': () => 'stages is not an object',
  'states.executionsNotList': () => 'executions is not a list',
  'states.stageNotObject': () => 'a stage is not an object',
  'states.notValidJson': () => 'not valid JSON',
  'states.configFileNotMapping': () => 'config.yaml must be a YAML mapping',
  'states.questionsNotList': () => 'questions is not a list',
  'states.notJsonObject': () => 'not a JSON object',
  'states.unexpectedOutput': () => 'unexpected output',

  // Fallbacks
  'states.aStage': () => 'A stage',
  'states.aRole': () => 'a role',
  'states.roleFallback': () => 'role',
  'states.unknownError': () => 'unknown error',
} as const;
