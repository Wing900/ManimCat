import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../shared/i18n';
import type { ProblemFramingPlan } from '../../../shared/types/api';
import { ProblemPlanEditor } from './ProblemPlanEditor';
import { ProblemFramingOverlay } from './ProblemFramingOverlay';

const plan: ProblemFramingPlan = {
  mode: 'clarify', headline: '梯子', summary: '解释变慢', question: '为什么？', answer: '等时位移递减。',
  audience: '初中', backgroundRules: '定长', selectedRoute: '勾股', alternativeRoutes: '不用求导', outOfScope: '摩擦', specialCases: '避开竖直', visualMotif: '梯子', designerHint: '90秒',
  steps: Array.from({ length: 12 }, (_, i) => ({ title: `标题${i + 1}`, content: `动作${i + 1}。`, phase: i < 2 ? 'background' : i < 3 ? 'phenomenon' : i < 11 ? 'derivation' : 'closing' })),
};
beforeEach(() => localStorage.setItem('manimcat_locale', 'zh-CN'));

describe('expanded planning card', () => {
  it('shows all twelve editable steps in ordered phase groups and collapses design basis', () => {
    render(<I18nProvider><ProblemPlanEditor plan={plan} onChange={vi.fn()} /></I18nProvider>);
    expect(screen.getByDisplayValue('动作12。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '推导' })).toBeTruthy();
    expect(document.querySelector('details')?.open).toBe(false);
    expect(screen.getByDisplayValue('勾股')).toBeTruthy();
  });
  it('editing the last step or answer preserves every other design decision', () => {
    const change = vi.fn();
    render(<I18nProvider><ProblemPlanEditor plan={plan} onChange={change} /></I18nProvider>);
    fireEvent.change(screen.getByDisplayValue('动作12。'), { target: { value: '回到现象。' } });
    const updated = change.mock.calls[0][0];
    expect(updated.steps).toHaveLength(12);
    expect(updated.steps[11].content).toBe('回到现象。');
    expect(updated.selectedRoute).toBe(plan.selectedRoute);
    fireEvent.change(screen.getByDisplayValue('等时位移递减。'), { target: { value: '新答案。' } });
    expect(change.mock.calls[1][0].answer).toBe('新答案。');
  });
  it('old cards remain editable without new fields', () => {
    const { question, answer, audience, backgroundRules, selectedRoute, alternativeRoutes, outOfScope, specialCases, ...legacy } = plan;
    void [question, answer, audience, backgroundRules, selectedRoute, alternativeRoutes, outOfScope, specialCases];
    render(<I18nProvider><ProblemPlanEditor plan={legacy} onChange={vi.fn()} /></I18nProvider>);
    expect(screen.getByDisplayValue('动作12。')).toBeTruthy();
    expect(screen.queryByDisplayValue('为什么？')).toBeNull();
  });
  it('keeps the card visible and prevents edits or generation while refining', () => {
    render(<I18nProvider><ProblemFramingOverlay open status="loading" plan={plan} error={null} adjustment="修改" generating={false} onAdjustmentChange={vi.fn()} onRetry={vi.fn()} onInitialRetry={vi.fn()} onPlanChange={vi.fn()} onGenerate={vi.fn()} onClose={vi.fn()} /></I18nProvider>);
    expect((screen.getByDisplayValue('动作12。') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '开始吧！' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('重新整理');
  });
});
