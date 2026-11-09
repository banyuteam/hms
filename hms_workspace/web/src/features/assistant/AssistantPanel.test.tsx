import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emrApi } from '@/api/emrApi';
import { emrKeys } from '@/api/hooks';
import { ApiError } from '@/api/liveApi';
import { AppProviders } from '@/AppProviders';
import { SYNTHETIC_CLAIM_EVALUATIONS } from '@/data/claimFixtures';
import { resourceCache } from '@/lib/resource';
import enEmr from '@/locales/en/emr.json';
import { useAssistantActions } from '@/state/assistant';
import { useHome } from '@/state/home';
import { AssistantPanel } from './AssistantPanel';
import { claimApi } from '@/api/claimApi';
import { feedbackApi } from '@/api/feedbackApi';

afterEach(() => {
  vi.restoreAllMocks();
  resourceCache.clear();
});

const NR = '2026/10/26/000123';
/** The panel's accessible name is the assistant's display name, whatever it is called. */
const PANEL = enEmr['emr.ai.title'];

/** Does what "Ask assistant" in a record window does: warms the journey and tags the encounter. */
function TagEncounter() {
  const { tag } = useAssistantActions();
  useEffect(() => {
    void resourceCache
      .prefetch(emrKeys.journey(NR), () => emrApi.getJourney(NR))
      .then(() => tag({ id: `enc:${NR}`, kind: 'encounter', norawat: NR }));
  }, [tag]);
  return null;
}

function renderPanel(withTag = false) {
  return render(
    <AppProviders initialLocale="en">
      {withTag && <TagEncounter />}
      <AssistantPanel />
    </AppProviders>,
  );
}

describe('AssistantPanel', () => {
  it('is a rail button when closed and opens docked', async () => {
    renderPanel();
    expect(screen.queryByRole('complementary', { name: PANEL })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /open/i }));
    expect(screen.getByRole('complementary', { name: PANEL })).toBeInTheDocument();
  });

  it('answers from the tagged record and refuses advice', async () => {
    renderPanel(true);
    const panel = await screen.findByRole('complementary', { name: PANEL });
    await waitFor(() => expect(within(panel).getByText(NR)).toBeInTheDocument());
    const box = within(panel).getByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'list diagnoses{Enter}');
    expect(
      await within(panel).findByText('1. I50.0 — Congestive heart failure'),
    ).toBeInTheDocument();
    await userEvent.type(box, 'what dose should I give?{Enter}');
    expect(within(panel).getByText(/can't give medical advice/i)).toBeInTheDocument();
  });

  it('shows the conversation as chat bubbles: question right with its context, answer left as the assistant, both timed', async () => {
    renderPanel(true);
    const panel = await screen.findByRole('complementary', { name: PANEL });
    const log = within(panel).getByRole('log', { name: 'Conversation' });
    await waitFor(() => expect(within(panel).getByText(NR)).toBeInTheDocument());
    await userEvent.type(
      within(panel).getByRole('textbox', { name: 'Message' }),
      'list diagnoses{Enter}',
    );
    const [question, answer] = within(log)
      .getAllByRole('listitem')
      .filter((li) => li.dataset.role);
    expect(question).toHaveAttribute('data-role', 'user');
    expect(within(question!).getByText('list diagnoses')).toBeInTheDocument();
    expect(within(question!).getByRole('list', { name: 'Tagged context' })).toHaveTextContent(NR);
    expect(answer).toHaveAttribute('data-role', 'assistant');
    expect(within(answer!).getByText(/assistant/i)).toBeInTheDocument();
    for (const bubble of [question!, answer!])
      expect(bubble.querySelector('time')?.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it('answers a claim question from the server: checking first, then every finding', async () => {
    const evaluate = vi.spyOn(claimApi, 'evaluate');
    renderPanel(true);
    const panel = await screen.findByRole('complementary', { name: PANEL });
    await waitFor(() => expect(within(panel).getByText(NR)).toBeInTheDocument());
    await userEvent.type(
      within(panel).getByRole('textbox', { name: 'Message' }),
      'is the claim ready?{Enter}',
    );
    expect(within(panel).getByText('Checking on the server…')).toBeInTheDocument();
    expect(await within(panel).findByText('Primary diagnosis coded')).toBeInTheDocument();
    expect(evaluate).toHaveBeenCalledWith(NR);
    expect(within(panel).queryByText('Checking on the server…')).toBeNull();
    const sep = within(panel).getByText('SEP present (BPJS)').closest('li') as HTMLElement;
    expect(within(sep).getByText('Complete')).toBeInTheDocument();
    expect(within(panel).queryByText(/Some checks could not be done/)).toBeNull();
    expect(within(panel).getByText(/not acceptance by the insurer/)).toBeInTheDocument();
  });

  it('a check the server could not do says why and makes the answer partial', async () => {
    const e = structuredClone(SYNTHETIC_CLAIM_EVALUATIONS[NR]!);
    e.findings = e.findings.map((f) =>
      f.rule_id === 'discharge_summary_present'
        ? { ...f, result: 'not_evaluated', reason: 'care_setting_unknown' }
        : f,
    );
    e.status = 'partial';
    vi.spyOn(claimApi, 'evaluate').mockResolvedValue(e);
    renderPanel(true);
    const panel = await screen.findByRole('complementary', { name: PANEL });
    await waitFor(() => expect(within(panel).getByText(NR)).toBeInTheDocument());
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Message' }), 'klaim{Enter}');
    const row = (await within(panel).findByText('Discharge summary present')).closest(
      'li',
    ) as HTMLElement;
    expect(within(row).getByText('Not checked')).toBeInTheDocument();
    expect(within(row).getByText("The visit's care setting is not recorded.")).toBeInTheDocument();
    expect(within(panel).getByText(/Some checks could not be done/)).toBeInTheDocument();
  });

  it('says nothing was checked when the server refuses, never shows a passed check', async () => {
    vi.spyOn(claimApi, 'evaluate').mockRejectedValue(new ApiError(403, 'reference_forbidden'));
    renderPanel(true);
    const panel = await screen.findByRole('complementary', { name: PANEL });
    await waitFor(() => expect(within(panel).getByText(NR)).toBeInTheDocument());
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Message' }), 'klaim{Enter}');
    expect(
      await within(panel).findByText('You do not have permission to run claim checks.'),
    ).toBeInTheDocument();
    expect(within(panel).queryByText('Complete')).toBeNull();
  });

  it('with only a patient tagged, it asks which visit and answers about none (F-7)', async () => {
    function TagPatient() {
      const { tag } = useAssistantActions();
      useEffect(() => tag({ id: 'pt:00012345', kind: 'patient', mrn: '00012345' }), [tag]);
      return null;
    }
    const getJourney = vi.spyOn(emrApi, 'getJourney');
    render(
      <AppProviders initialLocale="en">
        <TagPatient />
        <AssistantPanel />
      </AppProviders>,
    );
    const panel = await screen.findByRole('complementary', { name: PANEL });
    expect(within(panel).getByText('MRN 00012345')).toBeInTheDocument();
    await userEvent.type(
      within(panel).getByRole('textbox', { name: 'Message' }),
      'summarize{Enter}',
    );
    expect(
      within(panel).getByText(
        /Patient MRN 00012345 is tagged\. Tag the visit you are asking about/,
      ),
    ).toBeInTheDocument();
    expect(within(panel).queryByText(/^Source: visit/)).toBeNull();
    expect(getJourney).not.toHaveBeenCalled();
  });

  it('removes a tag with its chip button and maximizes/closes', async () => {
    renderPanel(true);
    const panel = await screen.findByRole('complementary', { name: PANEL });
    const remove = await within(panel).findByRole('button', {
      name: new RegExp(NR.replace(/\//g, '\\/')),
    });
    await userEvent.click(remove);
    expect(within(panel).queryByText(NR)).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: /maximi/i }));
    expect(panel).toHaveAttribute('data-mode', 'maximized');
    await userEvent.click(within(panel).getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('complementary', { name: PANEL })).toBeNull();
  });

  it('offers no file attachment (nothing could read it) and the send button is disabled while empty', async () => {
    renderPanel(true);
    const panel = await screen.findByRole('complementary', { name: PANEL });
    expect(within(panel).getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(panel.querySelector('input[type=file]')).toBeNull();
    expect(within(panel).queryByRole('button', { name: /attach/i })).toBeNull();
  });

  it('is not presented as AI (F-10)', async () => {
    renderPanel(true);
    const panel = await screen.findByRole('complementary', { name: PANEL });
    await waitFor(() => expect(within(panel).getByText(NR)).toBeInTheDocument());
    await userEvent.click(within(panel).getByRole('button', { name: 'Diagnoses' }));
    expect(panel).not.toHaveTextContent(/\bAI\b/);
  });

  describe('guided questions', () => {
    it('asks a topic about the tagged visit with one click, quoting the topic and the visit', async () => {
      renderPanel(true);
      const panel = await screen.findByRole('complementary', { name: PANEL });
      await waitFor(() => expect(within(panel).getByText(NR)).toBeInTheDocument());
      const topics = within(panel).getByRole('group', { name: `Ask about ${NR}:` });
      await userEvent.click(within(topics).getByRole('button', { name: 'Diagnoses' }));
      expect(
        await within(panel).findByText('1. I50.0 — Congestive heart failure'),
      ).toBeInTheDocument();
      const question = within(panel)
        .getAllByRole('listitem')
        .find((li) => li.dataset.role === 'user')!;
      expect(within(question).getByText('Diagnoses')).toBeInTheDocument();
      expect(within(question).getByRole('list', { name: 'Tagged context' })).toHaveTextContent(NR);
    });

    it('a tagged section puts its topic first', async () => {
      function TagSection() {
        const { tag } = useAssistantActions();
        useEffect(
          () => tag({ id: `enc:${NR}:claim`, kind: 'section', norawat: NR, section: 'claim' }),
          [tag],
        );
        return null;
      }
      render(
        <AppProviders initialLocale="en">
          <TagSection />
          <AssistantPanel />
        </AppProviders>,
      );
      const panel = await screen.findByRole('complementary', { name: PANEL });
      const topics = within(panel).getByRole('group', { name: /^Ask about/ });
      expect(within(topics).getAllByRole('button')[0]).toHaveTextContent('Claim readiness');
    });

    it('with two visits tagged it never guesses: choose a chip first (F-9)', async () => {
      const OTHER = '2026/08/14/000051';
      function TagTwo() {
        const { tag } = useAssistantActions();
        useEffect(() => {
          tag({ id: `enc:${NR}`, kind: 'encounter', norawat: NR });
          tag({ id: `enc:${OTHER}`, kind: 'encounter', norawat: OTHER });
        }, [tag]);
        return null;
      }
      const evaluate = vi.spyOn(claimApi, 'evaluate');
      render(
        <AppProviders initialLocale="en">
          <TagTwo />
          <AssistantPanel />
        </AppProviders>,
      );
      const panel = await screen.findByRole('complementary', { name: PANEL });
      expect(within(panel).queryByRole('group', { name: /^Ask about/ })).toBeNull();
      expect(within(panel).getByText(/Several visits are tagged/)).toBeInTheDocument();
      await userEvent.type(within(panel).getByRole('textbox', { name: 'Message' }), 'klaim{Enter}');
      expect(
        within(panel).getByText(/2 visits are tagged\. Choose the one you mean/),
      ).toBeInTheDocument();
      expect(evaluate).not.toHaveBeenCalled();

      const pick = within(panel).getByRole('button', { name: `Ask about ${OTHER}` });
      expect(pick).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(pick);
      expect(pick).toHaveAttribute('aria-pressed', 'true');
      const topics = within(panel).getByRole('group', { name: `Ask about ${OTHER}:` });
      await userEvent.click(within(topics).getByRole('button', { name: 'Claim readiness' }));
      expect(evaluate).toHaveBeenCalledWith(OTHER);
    });
  });

  describe('claim result', () => {
    it('shows counts, folds what needs no work, and says where to look and who reviews a gap', async () => {
      const e = structuredClone(SYNTHETIC_CLAIM_EVALUATIONS[NR]!);
      e.findings = e.findings.map((f) =>
        f.rule_id === 'primary_diagnosis_matches_summary'
          ? { ...f, result: 'failed', reason: 'mismatch', human_review: true }
          : f,
      );
      e.summary = { ...e.summary, passed: e.summary.passed - 1, failed_warning: 1 };
      vi.spyOn(claimApi, 'evaluate').mockResolvedValue(e);
      renderPanel(true);
      const panel = await screen.findByRole('complementary', { name: PANEL });
      await waitFor(() => expect(within(panel).getByText(NR)).toBeInTheDocument());
      await userEvent.click(within(panel).getByRole('button', { name: 'Claim readiness' }));

      const counts = await within(panel).findByRole('list', { name: 'Result counts' });
      expect(counts).toHaveTextContent('1 to check');
      expect(counts).toHaveTextContent('8 complete');
      const attention = within(panel).getByRole('region', { name: 'Needs attention (1)' });
      const row = within(attention)
        .getByText('Primary code matches discharge summary')
        .closest('li')!;
      expect(within(row).getByText('Check')).toBeInTheDocument();
      expect(
        within(row).getByText('Look in: Discharge Summary, Diagnoses (ICD-10)'),
      ).toBeInTheDocument();
      expect(within(attention).getByText(/Casemix staff review these/)).toBeInTheDocument();
      expect(within(panel).getByText('Complete (8)').closest('details')).not.toHaveAttribute(
        'open',
      );
      expect(within(panel).getByText(/^Checked by the server at \d{2}:\d{2}$/)).toBeInTheDocument();
    });

    it('next steps only navigate or ask the server again', async () => {
      const evaluate = vi.spyOn(claimApi, 'evaluate');
      let windows: string[] = [];
      function Windows() {
        windows = useHome().windows.map((w) => `${w.kind}:${w.params.norawat ?? ''}`);
        return null;
      }
      render(
        <AppProviders initialLocale="en">
          <TagEncounter />
          <Windows />
          <AssistantPanel />
        </AppProviders>,
      );
      const panel = await screen.findByRole('complementary', { name: PANEL });
      await waitFor(() => expect(within(panel).getByText(NR)).toBeInTheDocument());
      await userEvent.click(within(panel).getByRole('button', { name: 'Claim readiness' }));
      await userEvent.click(
        await within(panel).findByRole('button', { name: 'Open visit in Records' }),
      );
      expect(windows).toContain(`emr-records:${NR}`);
      await userEvent.click(within(panel).getByRole('button', { name: 'Check again' }));
      await waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2));
      expect(evaluate).toHaveBeenNthCalledWith(2, NR);
    });
  });

  describe('feedback on a claim answer (ADR-SVC-008)', () => {
    /** A claim answer with one finding that needs attention: the primary code does not match the summary. */
    async function claimAnswer() {
      const e = structuredClone(SYNTHETIC_CLAIM_EVALUATIONS[NR]!);
      e.findings = e.findings.map((f) =>
        f.rule_id === 'primary_diagnosis_matches_summary'
          ? { ...f, result: 'failed', reason: 'mismatch', human_review: true }
          : f,
      );
      vi.spyOn(claimApi, 'evaluate').mockResolvedValue(e);
      renderPanel(true);
      const panel = await screen.findByRole('complementary', { name: PANEL });
      await waitFor(() => expect(within(panel).getByText(NR)).toBeInTheDocument());
      await userEvent.click(within(panel).getByRole('button', { name: 'Claim readiness' }));
      await within(panel).findByRole('list', { name: 'Result counts' });
      return { panel, evaluationId: e.evaluation_id };
    }
    const FINDING = 'Primary code matches discharge summary';

    it('reports a problem with a finding: a reason is required, the comment is optional and trimmed', async () => {
      const submit = vi.spyOn(feedbackApi, 'submit');
      const { panel, evaluationId } = await claimAnswer();
      await userEvent.click(
        within(panel).getByRole('button', { name: `Report a problem with: ${FINDING}` }),
      );
      const form = within(panel).getByRole('form', { name: `Report a problem with: ${FINDING}` });
      expect(within(form).getByText(/Do not enter patient names/)).toBeInTheDocument();
      await userEvent.click(within(form).getByRole('button', { name: 'Send feedback' }));
      expect(await within(form).findByRole('alert')).toHaveTextContent('Choose what is wrong.');
      expect(submit).not.toHaveBeenCalled();

      await userEvent.click(
        within(form).getByRole('radio', { name: 'The record was corrected after the check' }),
      );
      await userEvent.type(
        within(form).getByRole('textbox', { name: 'Comment (optional)' }),
        '  Corrected on the ward.  ',
      );
      expect(within(form).getByText('26/200')).toBeInTheDocument();
      await userEvent.click(within(form).getByRole('button', { name: 'Send feedback' }));
      expect(
        await within(panel).findByText('Demo data: feedback is not sent.'),
      ).toBeInTheDocument();
      expect(submit).toHaveBeenCalledWith({
        evaluation_id: evaluationId,
        rule_id: 'primary_diagnosis_matches_summary',
        result: 'failed',
        reason: 'data_outdated',
        comment: 'Corrected on the ward.',
      });
    });

    it('says "sent" only after the server stored it, and the result on screen does not change', async () => {
      vi.spyOn(feedbackApi, 'submit').mockResolvedValue({ kind: 'sent', version: 1 });
      const { panel } = await claimAnswer();
      await userEvent.click(
        within(panel).getByRole('button', { name: `Report a problem with: ${FINDING}` }),
      );
      await userEvent.click(within(panel).getByRole('radio', { name: 'Unclear' }));
      await userEvent.click(within(panel).getByRole('button', { name: 'Send feedback' }));
      expect(
        await within(panel).findByText('Sent. Thank you — the result does not change.'),
      ).toBeInTheDocument();
      const row = within(panel).getByText(FINDING).closest('li') as HTMLElement;
      expect(within(row).getByText('Check')).toBeInTheDocument();
    });

    it('a failed send says nothing was saved and can be tried again with the same content', async () => {
      const submit = vi
        .spyOn(feedbackApi, 'submit')
        .mockRejectedValueOnce(new ApiError(0, 'NETWORK'))
        .mockResolvedValueOnce({ kind: 'sent', version: 1 });
      const { panel } = await claimAnswer();
      await userEvent.click(
        within(panel).getByRole('button', { name: `Report a problem with: ${FINDING}` }),
      );
      await userEvent.click(within(panel).getByRole('radio', { name: 'The result looks wrong' }));
      await userEvent.click(within(panel).getByRole('button', { name: 'Send feedback' }));
      expect(await within(panel).findByText(/nothing was saved/)).toBeInTheDocument();
      expect(within(panel).queryByText(/^Sent\./)).toBeNull();
      await userEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
      expect(await within(panel).findByText(/^Sent\./)).toBeInTheDocument();
      expect(submit).toHaveBeenCalledTimes(2);
      expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0]);
    });

    it('an expired check cannot be retried: it says why', async () => {
      vi.spyOn(feedbackApi, 'submit').mockRejectedValue(new ApiError(404, 'evaluation_not_found'));
      const { panel } = await claimAnswer();
      await userEvent.click(
        within(panel).getByRole('button', { name: `Report a problem with: ${FINDING}` }),
      );
      await userEvent.click(within(panel).getByRole('radio', { name: 'Unclear' }));
      await userEvent.click(within(panel).getByRole('button', { name: 'Send feedback' }));
      expect(await within(panel).findByText(/older than 7 days/)).toBeInTheDocument();
      expect(within(panel).queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('rates the answer: useful is sent at once, not useful may say what was expected', async () => {
      const submit = vi.spyOn(feedbackApi, 'submit');
      const { panel, evaluationId } = await claimAnswer();
      const question = within(panel).getByRole('group', { name: 'Was this answer useful?' });
      await userEvent.click(within(question).getByRole('button', { name: 'Not useful' }));
      expect(within(question).getByRole('button', { name: 'Not useful' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const form = within(panel).getByRole('form', { name: 'Feedback on this answer' });
      await userEvent.click(within(form).getByRole('radio', { name: 'Steps I can take' }));
      await userEvent.click(within(form).getByRole('button', { name: 'Send feedback' }));
      expect(
        await within(panel).findByText('Demo data: feedback is not sent.'),
      ).toBeInTheDocument();
      expect(submit).toHaveBeenCalledWith({
        evaluation_id: evaluationId,
        helpfulness: 'not_helpful',
        expected: 'actionable_steps',
        comment: undefined,
      });
    });

    it('a useful answer needs no form', async () => {
      const submit = vi.spyOn(feedbackApi, 'submit');
      const { panel, evaluationId } = await claimAnswer();
      await userEvent.click(within(panel).getByRole('button', { name: 'Useful' }));
      expect(submit).toHaveBeenCalledWith({ evaluation_id: evaluationId, helpfulness: 'helpful' });
      expect(within(panel).queryByRole('form', { name: 'Feedback on this answer' })).toBeNull();
    });
  });

  describe('tagging a visit by no_rawat', () => {
    async function searchInPanel() {
      renderPanel();
      await userEvent.click(screen.getByRole('button', { name: /open/i }));
      const panel = screen.getByRole('complementary', { name: PANEL });
      await userEvent.type(
        within(panel).getByRole('searchbox', { name: 'Tag a visit (no_rawat)' }),
        '2026/',
      );
      const results = await within(panel).findByRole('list', { name: /result/i });
      return { panel, results };
    }

    it('docked: the results scroll inside a fixed height, so they cannot push the composer out of the panel', async () => {
      const { panel, results } = await searchInPanel();
      expect(results).toHaveClass('max-h-search-results', 'overflow-y-auto');
      // The composer below the results stays in the panel and usable.
      expect(within(panel).getByRole('textbox', { name: 'Message' })).toBeVisible();
      await userEvent.click(within(results).getAllByRole('button')[0]!);
      expect(within(panel).getByRole('list', { name: 'Tagged context' })).toBeInTheDocument();
    });

    it('picking a visit tags it, empties the box and closes the list, and keeps the focus in the box', async () => {
      const { panel, results } = await searchInPanel();
      const picked = within(results).getAllByRole('button')[0]!;
      const norawat = picked.textContent?.match(/\d{4}\/\d{2}\/\d{2}\/\d{6}/)?.[0];
      await userEvent.click(picked);
      const box = within(panel).getByRole('searchbox', { name: 'Tag a visit (no_rawat)' });
      expect(box).toHaveValue('');
      expect(box).toHaveFocus();
      expect(within(panel).queryByRole('list', { name: /result/i })).toBeNull();
      expect(within(panel).getByRole('list', { name: 'Tagged context' })).toHaveTextContent(
        norawat!,
      );
      // The next search starts from an empty box.
      await userEvent.type(box, '2026/');
      expect(box).toHaveValue('2026/');
    });

    it('maximized: the search pane scrolls as a whole, the list keeps its full height', async () => {
      const { panel } = await searchInPanel();
      await userEvent.click(within(panel).getByRole('button', { name: /maximi/i }));
      // The picker moves to the side pane (a new search box).
      await userEvent.type(
        within(panel).getByRole('searchbox', { name: 'Tag a visit (no_rawat)' }),
        '2026/',
      );
      const results = await within(panel).findByRole('list', { name: /result/i });
      expect(results).not.toHaveClass('max-h-search-results');
    });
  });
});
