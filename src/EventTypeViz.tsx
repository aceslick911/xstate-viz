import { Search2Icon } from '@chakra-ui/icons';
import { useSelector } from '@xstate/react';
import React from 'react';
import type { InvokeDefinition } from 'xstate/lib/types';
import { useSimulation } from './SimulationContext';
import type { DelayedTransitionMetadata } from './TransitionViz';

import { selectServices } from './ActorsPanel';

export function toDelayString(delay: string | number): string {
  if (typeof delay === 'number' || !isNaN(+delay)) {
    return `${delay}ms`;
  }
  return delay;
}

export function formatInvocationId(id: string): string {
  if (isUnnamed(id)) {
    const match = id.match(/:invocation\[(\d+)\]$/);

    if (!match) {
      return id;
    }

    const [, index] = match;

    return `anonymous [${index}]`;
  }

  return id;
}

function isUnnamed(id: string): boolean {
  return /:invocation\[/.test(id);
}

const JumpButton = ({ id }: { id: string }) => {
  const simActor = useSimulation();
  const currentSessionId = useSelector(
    simActor,
    (s) => s.context.currentSessionId,
  );

  const services = useSelector(simActor, selectServices);
  const sessions = Object.entries(services);
  const foundSession = sessions.find((elem) => {
    return elem[1]?.machine?.id === id;
  });
  const foundMachine =
    foundSession && foundSession[1] && foundSession[1].machine;
  const sessionId = foundSession && foundSession[0];

  return (
    <button
      disabled={!foundMachine}
      onClick={() => {
        if (sessionId) {
          simActor.send({ type: 'SERVICE.FOCUS', sessionId, history: false });
        } else {
          alert(`Machine not found: ${id}`);
        }
      }}
    >
      <Search2Icon /> {id}
    </button>
  );
};

export function InvokeViz({ invoke }: { invoke: InvokeDefinition<any, any> }) {
  const unnamed = isUnnamed(invoke.id);
  const invokeSrc =
    typeof invoke.src === 'string' ? invoke.src : invoke.src.type;

  const id = unnamed ? 'anonymous' : invoke.id;

  return (
    <div
      data-viz="action"
      data-viz-action="invoke"
      title={`${id} (${invokeSrc})`}
    >
      <div data-viz="action-type">{unnamed ? <em>{id}</em> : id}</div>
      <JumpButton id={id} />
    </div>
  );
}

export const EventTypeViz: React.FC<{
  eventType: string;
  delay?: DelayedTransitionMetadata;
  onChangeEventType?: (eventType: string) => void;
}> = ({ eventType: event, delay, onChangeEventType }) => {
  if (event.startsWith('done.state.')) {
    return (
      <div data-viz="eventType" data-viz-keyword="done">
        <em data-viz="eventType-keyword">onDone</em>
      </div>
    );
  }

  if (event.startsWith('done.invoke.')) {
    const match = event.match(/^done\.invoke\.(.+)$/);
    return (
      <div data-viz="eventType" data-viz-keyword="done">
        <em data-viz="eventType-keyword">done:</em>{' '}
        <div data-viz="eventType-text">
          {match ? formatInvocationId(match[1]) : '??'}
        </div>
      </div>
    );
  }

  if (event.startsWith('error.platform.')) {
    const match = event.match(/^error\.platform\.(.+)$/);
    return (
      <div data-viz="eventType" data-viz-keyword="error">
        <em data-viz="eventType-keyword">error:</em>{' '}
        <div data-viz="eventType-text">{match ? match[1] : '??'}</div>
      </div>
    );
  }

  if (delay?.delayType === 'DELAYED_INVALID') {
    return <div data-viz="eventType">{event}</div>;
  }

  if (delay?.delayType === 'DELAYED_VALID') {
    return (
      <div data-viz="eventType" data-viz-keyword="after">
        <em data-viz="eventType-keyword">after</em>{' '}
        <div data-viz="eventType-text">{delay.delayString}</div>
      </div>
    );
  }

  if (event === '') {
    return (
      <div data-viz="eventType" data-viz-keyword="always">
        <em data-viz="eventType-keyword">always</em>
      </div>
    );
  }

  return (
    <div data-viz="eventType">
      <div data-viz="eventType-text">{event}</div>
    </div>
  );
};
