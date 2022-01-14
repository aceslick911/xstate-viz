# XState Visualizer

Visualize [XState](https://xstate.js.org) state machines and statecharts in real-time.

[🔗 Use the Visualizer](https://stately.ai/viz).

## Changes in this fork

- Added ability to quickly jump back and forward between Actors/Machine Instances
- Added button in invoke states to jump to the new actor when spawned
- Public website - Use the following link to view it live
  - Visit: [Visualizer on Vercel](http://xstate-viz-7qxw4g26p-aceslick911.vercel.app/viz)
  - Visit: [Inspect on Vercel](http://xstate-viz-7qxw4g26p-aceslick911.vercel.app/viz?inspect)

### In Progress:

- Adding websockets support

### Todo:

- Add built in websockets server

## Usage

[Visit stately.ai/viz to use the Visualizer](https://stately.ai/viz).

Alternatively, you can install it locally (see installation)

## Features

- Create XState machines in JavaScript or TypeScript right in the visualizer
- Simulate machines visually by clicking on events
- Pan and zoom into the visualized machine
- View current machine state
- View list of events sent to the simulated machine
- Access quick features via the command palette: <kbd>cmd</kbd>/<kbd>ctrl</kbd> + <kbd>k</kbd>
- Inspect machines by setting `url: 'https://stately.ai/viz?inspect'` in `@xstate/inspect`
- Save your machines in the [Stately Registry](https://stately.ai/registry)
- _And many more upcoming features_

## Installation

1. Clone this GitHub repo
1. Run `yarn install`
1. Run `npm start` and visit [localhost:3000](https://localhost:3000)

## Releases

https://www.loom.com/share/5357e00577e64387b45de8ee65cb3805
