import { OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UiStore } from './ui.store';

describe('UiStore theme behavior', () => {
  let store: InstanceType<typeof UiStore>;
  let overlayContainer: OverlayContainer;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
    TestBed.configureTestingModule({ providers: [UiStore] });
    store = TestBed.inject(UiStore);
    overlayContainer = TestBed.inject(OverlayContainer);
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('propagates dark mode to the application root and CDK overlays', () => {
    store.setThemeMode('dark');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(overlayContainer.getContainerElement().classList.contains('dark')).toBe(true);
  });

  it('persists the selected mode and restores light surfaces', () => {
    store.setThemeMode('dark');
    store.setThemeMode('light');

    expect(localStorage.getItem('liass-ohada.themeMode')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(overlayContainer.getContainerElement().classList.contains('dark')).toBe(false);
  });

  it('persists the desktop sidebar collapsed preference', () => {
    store.setSidebarCollapsed(true);

    expect(store.sidebarCollapsed()).toBe(true);
    expect(localStorage.getItem('liass-ohada.sidebarCollapsed')).toBe('true');

    store.toggleSidebarCollapsed();

    expect(store.sidebarCollapsed()).toBe(false);
    expect(localStorage.getItem('liass-ohada.sidebarCollapsed')).toBe('false');
  });
});
