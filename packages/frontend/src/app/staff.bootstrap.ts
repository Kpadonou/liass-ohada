import { bootstrapApplication } from '@angular/platform-browser';
import './core/auth/amplify.config';
import { appConfig } from './app.config';
import { App } from './app';
export const bootstrapStaff = () => bootstrapApplication(App, appConfig);
