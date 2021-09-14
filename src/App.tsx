import { Box, ChakraProvider } from '@chakra-ui/react';
import React, { useEffect, useMemo } from 'react';
import { useActor, useInterpret, useSelector } from '@xstate/react';
import { useAuth } from './authContext';
import { CanvasProvider } from './CanvasContext';
import { EmbedProvider, useEmbed } from './embedContext';
import { CanvasView } from './CanvasView';
import './Graph';
import { isOnClientSide } from './isOnClientSide';
import { MachineNameChooserModal } from './MachineNameChooserModal';
import { PaletteProvider } from './PaletteContext';
import { paletteMachine } from './paletteMachine';
import { PanelsView } from './PanelsView';
import { SimulationProvider } from './SimulationContext';
import { simulationMachine } from './simulationMachine';
import { getSourceActor } from './sourceMachine';
import { theme } from './theme';
import { EditorThemeProvider } from './themeContext';
import { EmbedContext, EmbedMode } from './types';
import { useInterpretCanvas } from './useInterpretCanvas';
import { useRouter } from 'next/router';
import { parseEmbedQuery, withoutEmbedQueryParams } from './utils';
