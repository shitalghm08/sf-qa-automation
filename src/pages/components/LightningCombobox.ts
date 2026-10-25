import { Locator } from '@playwright/test';
import { esc, looseLabel } from '../BasePage';

/**
 * lightning-combobox (every picklist in a record form).
 *
 * Why this exists: the visible "dropdown" is a <button role="combobox"> living
 * inside nested shadow roots, its ids are generated at render time and the label
 * is wired with ids that don't survive a re-render. So I never touch ids or css
 * classes - only role + accessible name, which Playwright resolves through open
 * shadow roots. Options are matched by role=option and by the data-value that
 * lightning-base-combobox-item puts on each row.
 * (see NOTES.md, Part C.a)
 */
export class LightningCombobox {
  constructor(private readonly scope: Locator) {}

  trigger(label: string): Locator {
    return this.scope.getByRole('combobox', { name: looseLabel(label) }).first();
  }

  option(value: string): Locator {
    const byRole = this.scope.getByRole('option', { name: new RegExp(`^\\s*${esc(value)}\\s*$`, 'i') });
    const byData = this.scope.locator(`[role="option"][data-value="${value.replace(/"/g, '\\"')}"]`);
    return byRole.or(byData).first();
  }

  async select(label: string, value: string): Promise<void> {
    const trigger = this.trigger(label);
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    const opt = this.option(value);
    try {
      await opt.click({ timeout: 8_000 });
    } catch (err) {
      // the most common reason is an org with different picklist values, so say what is there
      const available = await this.scope.getByRole('option').allInnerTexts().catch(() => [] as string[]);
      throw new Error(
        `Picklist "${label}": could not pick "${value}". Options currently visible: [${available
          .map((t) => t.trim())
          .filter(Boolean)
          .join(' | ')}]. Original error: ${(err as Error).message}`,
      );
    }
  }

  /** current text shown on the closed picklist button */
  async currentValue(label: string): Promise<string> {
    return (await this.trigger(label).innerText()).trim();
  }
}
