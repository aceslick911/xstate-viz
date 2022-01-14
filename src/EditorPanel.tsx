import {
  AddIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
} from '@chakra-ui/icons';

import {
  Box,
  Button,
  FormLabel,
  HStack,
  IconProps,
  Input,
  Switch,
  IconButton,
  Tooltip,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  Portal,
  ButtonGroup,
  PopoverTrigger,
  Table,
  Tbody,
  Text,
  Th,
  Thead,
  Tr,
  Td,
  TabPanel,
} from '@chakra-ui/react';
import type { Monaco } from '@monaco-editor/react';
import Editor from '@monaco-editor/react';
import { useActor, useMachine, useSelector } from '@xstate/react';
import { editor, Range } from 'monaco-editor';
import dynamic from 'next/dynamic';
import React, { useState } from 'react';
import {
  ActorRefFrom,
  assign,
  DoneInvokeEvent,
  send,
  spawn,
  SCXML,
} from 'xstate';
import { createModel } from 'xstate/lib/model';
import { JSONView } from './JSONView';
import { useAuth } from './authContext';
import { CommandPalette } from './CommandPalette';
import { useEmbed } from './embedContext';
import { ForkIcon, MagicIcon, SaveIcon } from './Icons';
import { notifMachine } from './notificationMachine';
import { parseMachines } from './parseMachine';
import { useSimulation, useSimulationMode } from './SimulationContext';
import {
  getEditorValue,
  getShouldImmediateUpdate,
  SourceMachineActorRef,
  SourceMachineState,
} from './sourceMachine';
import type { AnyStateMachine } from './types';
import { getPlatformMetaKeyLabel, uniq } from './utils';
import { toSCXMLEvent } from 'xstate/lib/utils';
import { format } from 'date-fns';

function buildGistFixupImportsText(usedXStateGistIdentifiers: string[]) {
  const rootNames: string[] = [];
  let text = '';

  for (const identifier of usedXStateGistIdentifiers) {
    switch (identifier) {
      case 'raise':
        rootNames.push('actions');
        text += 'const { raise } = actions;\n';
        break;
      case 'XState':
        text += 'import * as XState from "xstate";\n';
        break;
      default:
        rootNames.push(identifier);
        break;
    }
  }

  if (rootNames.length) {
    // this uses `uniq` on the `rootNames` list because `actions` could be pushed into it while it was already in the list
    text = `import { ${uniq(rootNames).join(', ')} } from "xstate";\n${text}`;
  }

  return text;
}

class SyntaxError extends Error {
  range: Range;
  constructor(message: string, range: Range) {
    super(message);
    this.range = range;
  }

  get title() {
    return `SyntaxError at Line:${this.range.startLineNumber} Col:${this.range.endColumn}`;
  }

  toString() {
    return this.message;
  }
}

const EditorWithXStateImports = dynamic(
  () => import('./EditorWithXStateImports'),
);

const editorPanelModel = createModel(
  {
    code: '',
    notifRef: undefined! as ActorRefFrom<typeof notifMachine>,
    monacoRef: null as Monaco | null,
    standaloneEditorRef: null as editor.IStandaloneCodeEditor | null,
    sourceRef: null as SourceMachineActorRef,
    mainFile: 'main.ts',
    machines: null as AnyStateMachine[] | null,
    deltaDecorations: [] as string[],
  },
  {
    events: {
      COMPILE: () => ({}),
      EDITOR_READY: (
        monacoRef: Monaco,
        standaloneEditorRef: editor.IStandaloneCodeEditor,
      ) => ({ monacoRef, standaloneEditorRef }),
      UPDATE_MACHINE_PRESSED: () => ({}),
      EDITOR_ENCOUNTERED_ERROR: (message: string, title?: string) => ({
        message,
        title,
      }),
      EDITOR_CHANGED_VALUE: (code: string) => ({ code }),
    },
  },
);

const editorPanelMachine = editorPanelModel.createMachine(
  {
    entry: [assign({ notifRef: () => spawn(notifMachine) })],
    initial: 'booting',
    states: {
      booting: {
        initial: 'waiting_for_monaco',
        on: { EDITOR_CHANGED_VALUE: undefined },
        states: {
          waiting_for_monaco: {
            on: {
              EDITOR_READY: [
                {
                  cond: 'isGist',
                  target: 'fixing_gist_imports',
                  actions: editorPanelModel.assign({
                    monacoRef: (_, e) => e.monacoRef,
                    standaloneEditorRef: (_, e) => e.standaloneEditorRef,
                  }),
                },
                {
                  target: 'done',
                  actions: editorPanelModel.assign({
                    monacoRef: (_, e) => e.monacoRef,
                    standaloneEditorRef: (_, e) => e.standaloneEditorRef,
                  }),
                },
              ],
            },
          },
          fixing_gist_imports: {
            invoke: {
              src: async (ctx) => {
                const monaco = ctx.monacoRef!;
                const uri = monaco.Uri.parse(ctx.mainFile);
                const getWorker =
                  await monaco.languages.typescript.getTypeScriptWorker();
                const tsWorker = await getWorker(uri);

                const usedXStateGistIdentifiers: string[] = await (
                  tsWorker as any
                ).queryXStateGistIdentifiers(uri.toString());

                if (usedXStateGistIdentifiers.length > 0) {
                  const fixupImportsText = buildGistFixupImportsText(
                    usedXStateGistIdentifiers,
                  );
                  const model = monaco.editor.getModel(uri)!;
                  const currentValue = model.getValue();
                  model.setValue(`${fixupImportsText}\n${currentValue}`);
                }
              },
              onDone: 'done',
              onError: {
                actions: ['broadcastError'],
              },
            },
          },
          done: {
            type: 'final',
          },
        },
        onDone: [
          {
            cond: (ctx) =>
              getShouldImmediateUpdate(ctx.sourceRef.getSnapshot()!),
            target: 'compiling',
          },
          { target: 'active' },
        ],
      },
      active: {},
      updating: {
        tags: ['visualizing'],
        entry: send('UPDATE_MACHINE_PRESSED'),
        always: 'active',
      },
      compiling: {
        tags: ['visualizing'],
        invoke: {
          src: async (ctx) => {
            const monaco = ctx.monacoRef!;
            const uri = monaco.Uri.parse(ctx.mainFile);
            const tsWoker = await monaco.languages.typescript
              .getTypeScriptWorker()
              .then((worker) => worker(uri));

            const syntaxErrors = await tsWoker.getSyntacticDiagnostics(
              uri.toString(),
            );

            if (syntaxErrors.length > 0) {
              const model = ctx.monacoRef?.editor.getModel(uri);
              // Only report one error at a time
              const error = syntaxErrors[0];

              const start = model?.getPositionAt(error.start!);
              const end = model?.getPositionAt(error.start! + error.length!);
              const errorRange = new ctx.monacoRef!.Range(
                start?.lineNumber!,
                0, // beginning of the line where error occured
                end?.lineNumber!,
                end?.column!,
              );
              return Promise.reject(
                new SyntaxError(error.messageText.toString(), errorRange),
              );
            }

            const compiledSource = await tsWoker
              .getEmitOutput(uri.toString())
              .then((result) => result.outputFiles[0].text);

            return parseMachines(compiledSource);
          },
          onDone: {
            target: 'updating',
            actions: [
              assign({
                machines: (_, e: any) => e.data,
              }),
            ],
          },
          onError: [
            {
              cond: 'isSyntaxError',
              target: 'active',
              actions: [
                'addDecorations',
                'scrollToLineWithError',
                'broadcastError',
              ],
            },
            {
              target: 'active',
              actions: ['broadcastError'],
            },
          ],
        },
      },
    },
    on: {
      EDITOR_CHANGED_VALUE: {
        actions: [
          editorPanelModel.assign({ code: (_, e) => e.code }),
          'onChangedCodeValue',
          'clearDecorations',
        ],
      },
      EDITOR_ENCOUNTERED_ERROR: {
        actions: send(
          (_, e) => ({
            type: 'BROADCAST',
            status: 'error',
            message: e.message,
          }),
          {
            to: (ctx) => ctx.notifRef,
          },
        ),
      },
      UPDATE_MACHINE_PRESSED: {
        actions: 'onChange',
      },
      COMPILE: 'compiling',
    },
  },
  {
    guards: {
      isGist: (ctx) =>
        ctx.sourceRef.getSnapshot()!.context.sourceProvider === 'gist',
      isSyntaxError: (_, e: any) => e.data instanceof SyntaxError,
    },
    actions: {
      broadcastError: send((_, e: any) => ({
        type: 'EDITOR_ENCOUNTERED_ERROR',
        title: e.data.title,
        message: e.data.message,
      })),
      addDecorations: assign({
        deltaDecorations: (ctx, e) => {
          const {
            data: { range },
          } = e as DoneInvokeEvent<{ message: string; range: Range }>;
          if (ctx.standaloneEditorRef) {
            // TODO: this Monaco API performs a side effect of clearing previous deltaDecorations while creating new decorations
            // Since XState reserves the right to assume assign actions are pure, think of a way to split the effect from assignment
            const newDecorations = ctx.standaloneEditorRef.deltaDecorations(
              ctx.deltaDecorations,
              [
                {
                  range,
                  options: {
                    isWholeLine: true,
                    glyphMarginClassName: 'editor__glyph-margin',
                    className: 'editor__error-content',
                  },
                },
              ],
            );
            return newDecorations;
          }
          return ctx.deltaDecorations;
        },
      }),
      clearDecorations: assign({
        deltaDecorations: (ctx) =>
          ctx.standaloneEditorRef!.deltaDecorations(ctx.deltaDecorations, []),
      }),
      scrollToLineWithError: (ctx, e) => {
        const {
          data: { range },
        } = e as DoneInvokeEvent<{ message: string; range: Range }>;
        const editor = ctx.standaloneEditorRef;
        editor?.revealLineInCenterIfOutsideViewport(range.startLineNumber);
      },
    },
  },
);

export type SourceOwnershipStatus =
  | 'user-owns-source'
  | 'no-source'
  | 'user-does-not-own-source';

const getSourceOwnershipStatus = (sourceState: SourceMachineState) => {
  let sourceStatus: SourceOwnershipStatus = 'no-source';

  if (!sourceState.matches('no_source')) {
    if (
      sourceState.context.loggedInUserId ===
      sourceState.context.sourceRegistryData?.system?.owner?.id
    ) {
      sourceStatus = 'user-owns-source';
    } else {
      sourceStatus = 'user-does-not-own-source';
    }
  }

  return sourceStatus;
};

const getPersistTextAndIcon = (
  isSignedOut: boolean,
  sourceOwnershipStatus: SourceOwnershipStatus,
): { text: string; Icon: React.FC<IconProps> } => {
  if (isSignedOut) {
    switch (sourceOwnershipStatus) {
      case 'no-source':
        return { text: 'Login to save', Icon: SaveIcon };
      case 'user-does-not-own-source':
      case 'user-owns-source':
        return { text: 'Login to fork', Icon: ForkIcon };
    }
  }
  switch (sourceOwnershipStatus) {
    case 'no-source':
    case 'user-owns-source':
      return { text: 'Save', Icon: SaveIcon };
    case 'user-does-not-own-source':
      return { text: 'Fork', Icon: ForkIcon };
  }
};

const NewEvent: React.FC<{
  onSend: (scxmlEvent: SCXML.Event<any>) => void;
  nextEvents?: string[];
}> = ({ onSend, nextEvents }) => {
  // const [state, send] = useMachine(newEventMachine, {
  //   actions: {
  //     sendEvent: (ctx) => {
  //       try {
  //         const scxmlEvent = toSCXMLEvent(JSON.parse(ctx.eventString));

  //         onSend(scxmlEvent);
  //       } catch (e) {
  //         console.error(e);
  //       }
  //     },
  //   },
  // });

  return (
    <Box
      display="flex"
      flexDirection="row"
      css={{
        gap: '.5rem', // TODO: source from Chakra
      }}
    >
      <Popover>
        {({ onClose }) => (
          <>
            <PopoverTrigger>
              <Button variant="outline">Send event</Button>
            </PopoverTrigger>
            <Portal>
              <PopoverContent>
                <PopoverArrow />
                <PopoverHeader
                  display="flex"
                  flexWrap="wrap"
                  css={{
                    gap: '.5rem',
                  }}
                >
                  {nextEvents &&
                    nextEvents.map((nextEvent) => (
                      <Button
                        key={nextEvent}
                        size="xs"
                        colorScheme="blue"
                        onClick={
                          () => {}
                          // send(
                          //   newEventModel.events['EVENT.PAYLOAD'](
                          //     `{\n\t"type": "${nextEvent}"\n}`,
                          //   ),
                          // )
                        }
                      >
                        {nextEvent}
                      </Button>
                    ))}
                </PopoverHeader>
                <PopoverBody bg="gray.800">
                  <Editor
                    language="json"
                    options={{
                      minimap: { enabled: false },
                      lineNumbers: 'off',
                      tabSize: 2,
                    }}
                    height="150px"
                    width="auto"
                    value={
                      '1'
                      //state.context.eventString
                    }
                    onChange={(text) => {
                      // text && send(newEventModel.events['EVENT.PAYLOAD'](text));
                    }}
                  />
                </PopoverBody>
                <PopoverFooter display="flex" justifyContent="flex-end">
                  <ButtonGroup spacing={2}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        // send(newEventModel.events['EVENT.RESET']());
                        // onClose();
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={
                        false
                        //  !state.hasTag('valid')
                      }
                      onClick={() => {
                        // send(newEventModel.events['EVENT.SEND']());
                        // onClose();
                      }}
                    >
                      Send
                    </Button>
                  </ButtonGroup>
                </PopoverFooter>
              </PopoverContent>
            </Portal>
          </>
        )}
      </Popover>
    </Box>
  );
};

const EventRow: React.FC<{
  event: { client: string; msg: Object; date: Date };
}> = ({ event }) => {
  const [show, setShow] = useState(false);

  return (
    <>
      <Tr cursor="pointer" onClick={() => setShow(!show)}>
        <Td>
          {show ? <ChevronDownIcon /> : <ChevronRightIcon />}
          {event.client}
        </Td>
        <Td color="gray.500" textAlign="right">
          {/* <EventConnection event={event} /> */}
        </Td>
        <Td color="gray.500">{format(event.date, 'H:mm:ss')}</Td>
      </Tr>
      {show ? (
        <Tr>
          <Td colSpan={3}>
            <JSONView src={event.msg} />
          </Td>
        </Tr>
      ) : null}
    </>
  );
};

export const EditorPanel: React.FC<{
  onSave: () => void;
  onFork: () => void;
  onCreateNew: () => void;
  onChange: (machine: AnyStateMachine[]) => void;
  onChangedCodeValue: (code: string) => void;
}> = ({ onSave, onChange, onChangedCodeValue, onFork, onCreateNew }) => {
  const embed = useEmbed();
  const authService = useAuth();
  const [authState] = useActor(authService);
  const sourceService = useSelector(
    authService,
    (state) => state.context.sourceRef!,
  );
  const [sourceState] = useActor(sourceService);

  const sourceOwnershipStatus = getSourceOwnershipStatus(sourceState);

  const simService = useSimulation();
  const simulationMode = useSimulationMode();

  const persistMeta = getPersistTextAndIcon(
    authState.matches('signed_out'),
    sourceOwnershipStatus,
  );

  const value = getEditorValue(sourceState);

  const [current, send] = useMachine(editorPanelMachine, {
    actions: {
      onChange: (ctx) => {
        onChange(ctx.machines!);
      },
      onChangedCodeValue: (ctx) => {
        onChangedCodeValue(ctx.code);
      },
    },
    context: {
      ...editorPanelModel.initialContext,
      code: value,
      sourceRef: sourceService,
    },
  });
  const isVisualizing = current.hasTag('visualizing');

  const isWebsockMode = useSelector(simService, (state) =>
    state.hasTag('websock-mode'),
  );

  const { websockSettings } = useSelector(simService, (state) => state.context);
  console.log({ websockSettings });
  const stickyProps = {
    position: 'sticky',
    top: 0,
    backgroundColor: 'var(--chakra-colors-gray-800)',
    zIndex: 1,
  } as const;
  return (
    <>
      {simulationMode === 'visualizing' && (
        <CommandPalette
          onSave={() => {
            onSave();
          }}
          onVisualize={() => {
            send('COMPILE');
          }}
        />
      )}
      <Box
        height="100%"
        display="grid"
        gridTemplateRows="1fr auto"
        data-testid="editor"
      >
        {simulationMode === 'visualizing' && (
          <>
            {/* This extra div acts as a placeholder that is supposed to stretch while EditorWithXStateImports lazy-loads (thanks to `1fr` on the grid) */}
            <div style={{ minHeight: 0, minWidth: 0 }}>
              <EditorWithXStateImports
                value={value}
                onMount={(standaloneEditor, monaco) => {
                  send({
                    type: 'EDITOR_READY',
                    monacoRef: monaco,
                    standaloneEditorRef: standaloneEditor,
                  });
                }}
                onChange={(code) => {
                  send({ type: 'EDITOR_CHANGED_VALUE', code });
                }}
                onFormat={() => {
                  send({
                    type: 'COMPILE',
                  });
                }}
                onSave={() => {
                  onSave();
                }}
              />
            </div>
            <HStack padding="2" w="full" justifyContent="space-between">
              <HStack>
                {!(embed?.isEmbedded && embed.readOnly) && (
                  <Tooltip
                    bg="black"
                    color="white"
                    label={`${getPlatformMetaKeyLabel()} + Enter`}
                    closeDelay={500}
                  >
                    <Button
                      disabled={isVisualizing}
                      isLoading={isVisualizing}
                      leftIcon={
                        <MagicIcon fill="gray.200" height="16px" width="16px" />
                      }
                      onClick={() => {
                        send({
                          type: 'COMPILE',
                        });
                      }}
                      variant="secondary"
                    >
                      Visualize
                    </Button>
                  </Tooltip>
                )}
                {!embed?.isEmbedded && (
                  <Tooltip
                    bg="black"
                    color="white"
                    label={`${getPlatformMetaKeyLabel()} + S`}
                    closeDelay={500}
                  >
                    <Button
                      isLoading={sourceState.hasTag('persisting')}
                      disabled={sourceState.hasTag('persisting')}
                      onClick={() => {
                        onSave();
                      }}
                      leftIcon={
                        <persistMeta.Icon
                          fill="gray.200"
                          height="16px"
                          width="16px"
                        />
                      }
                      variant="outline"
                    >
                      {persistMeta.text}
                    </Button>
                  </Tooltip>
                )}
                {sourceOwnershipStatus === 'user-owns-source' &&
                  !embed?.isEmbedded && (
                    <Button
                      disabled={sourceState.hasTag('forking')}
                      isLoading={sourceState.hasTag('forking')}
                      onClick={() => {
                        onFork();
                      }}
                      leftIcon={
                        <ForkIcon fill="gray.200" height="16px" width="16px" />
                      }
                      variant="outline"
                    >
                      Fork
                    </Button>
                  )}
              </HStack>
              {sourceOwnershipStatus !== 'no-source' && !embed?.isEmbedded && (
                <Button
                  leftIcon={<AddIcon fill="gray.200" />}
                  onClick={onCreateNew}
                  variant="outline"
                >
                  New
                </Button>
              )}
            </HStack>
          </>
        )}
        {simulationMode === 'inspecting' && isWebsockMode ? (
          // <Box padding="4">
          //   <Text as="strong">Websockets Connection</Text>
          //   <Text>
          //     Trying to connect to {websockSettings.server} on port{' '}
          //     {websockSettings.port}, using protocol:
          //     {websockSettings.protocol.toUpperCase()}
          //   </Text>
          // </Box>

          <Box
            display="grid"
            gridTemplateRows="0fr 0fr 1fr"
            gridRowGap="2"
            height="100%"
            justifyContent="center"
            alignItems="start"
            style={{ marginTop: '10px' }}
          >
            <Box
              display="flex"
              justifyContent="space-evenly"
              alignItems="center"
            >
              <FormLabel
                style={{ whiteSpace: 'nowrap' }}
                display="flex"
                justifyContent="flex-start"
              >
                Websockets Server
              </FormLabel>

              <Box display="flex" justifyContent="flex-end" alignItems="center">
                <FormLabel
                  marginRight="auto"
                  htmlFor="builtin-toggle"
                  width="40%"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Websockets Enabled
                </FormLabel>
                <Switch
                  id="builtin-toggle"
                  defaultChecked={isWebsockMode}
                  onChange={(e) => {
                    // sendToEventsMachine({
                    //   type: 'TOGGLE_BUILTIN_EVENTS',
                    //   showBuiltins: e.target.checked,
                    // });
                  }}
                />
              </Box>
            </Box>
            <Box
              display="flex"
              justifyContent="flex-start"
              alignItems="flex-start"
            >
              <FormLabel>Server</FormLabel>
              <Input
                placeholder="Websockets Server Host eg.localhost"
                type="text"
                onChange={(e) => {
                  // sendToEventsMachine({
                  //   type: 'FILTER_BY_KEYWORD',
                  //   keyword: e.target.value,
                  // });
                }}
                value={websockSettings.server}
                marginRight="auto"
                width="40%"
              />
              <FormLabel>PORT</FormLabel>
              <Input
                placeholder="Port eg.8888"
                type="number"
                onChange={(e) => {
                  // sendToEventsMachine({
                  //   type: 'FILTER_BY_KEYWORD',
                  //   keyword: e.target.value,
                  // });
                }}
                value={websockSettings.port}
                marginRight="auto"
                width="40%"
              />
            </Box>
            <Box overflowY="auto" display="flex" justifyContent="flex-start">
              <Table width="100%" height="100%" style={{ minHeight: '500px' }}>
                <Thead>
                  <Tr>
                    <Th {...stickyProps} width="100%">
                      Log
                    </Th>
                    <Th {...stickyProps}>Client</Th>
                    <Th {...stickyProps} whiteSpace="nowrap">
                      Time
                      <Box
                        display="inline-flex"
                        flexDirection="column"
                        verticalAlign="middle"
                        marginLeft="1"
                      >
                        <IconButton
                          aria-label="sort by timestamp descending"
                          title="sort by timestamp descending"
                          icon={<ChevronUpIcon />}
                          variant="unstyled"
                          size="xs"
                          bg={
                            true ? 'var(--chakra-colors-gray-700)' : undefined
                          }
                          onClick={() => {
                            // sendToEventsMachine({
                            //   type: 'SORT_BY_TIMESTAMP',
                            //   sortCriteria: 'DESC',
                            // });
                          }}
                        />
                        <IconButton
                          aria-label="sort by timestamp ascending"
                          title="sort by timestamp ascending"
                          icon={<ChevronDownIcon />}
                          variant="unstyled"
                          size="xs"
                          bg={
                            true ? 'var(--chakra-colors-gray-700)' : undefined
                          }
                          onClick={() => {
                            // sendToEventsMachine({
                            //   type: 'SORT_BY_TIMESTAMP',
                            //   sortCriteria: 'ASC',
                            // });
                          }}
                        />
                      </Box>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {websockSettings.events.map((event, i) => {
                    return <EventRow event={event} key={i} />;
                  })}
                </Tbody>
              </Table>
            </Box>
            <NewEvent
              onSend={
                (event) => {}
                //send({ type: 'SERVICE.SEND', event })
              }
              nextEvents={
                []
                //nextEvents
              }
            />
          </Box>
        ) : (
          <Box padding="4">
            <Text as="strong">Inspection mode</Text>
            <Text>
              Services from a separate process are currently being inspected.
            </Text>
          </Box>
        )}
      </Box>
    </>
  );
};
