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
