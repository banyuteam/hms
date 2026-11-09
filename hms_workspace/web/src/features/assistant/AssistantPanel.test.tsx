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
import { AssistantPanel } from './AssistantPanel';
import { claimApi } from '@/api/claimApi';

afterEach(() => {
  vi.restoreAllMocks();
  resourceCache.clear();
});

const NR = '2026/10/26/000123';
/** The panel's accessible name is the assistant's display name, whatever it is called. */
const PANEL = enEmr['emr.ai.title'];

/** Does what "Ask AI" in a record window does: warms the journey and tags the encounter. */
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

  it('lists attachments by name only and the send button is disabled while empty', async () => {
    renderPanel(true);
    const panel = await screen.findByRole('complementary', { name: PANEL });
    expect(within(panel).getByRole('button', { name: 'Send' })).toBeDisabled();
    const input = panel.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(input, new File(['secret'], 'lab.pdf', { type: 'application/pdf' }));
    expect(within(panel).getByText('lab.pdf')).toBeInTheDocument();
  });
});
