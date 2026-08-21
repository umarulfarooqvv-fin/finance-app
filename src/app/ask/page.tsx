import { aiConfigured } from '../../ai/ask.ts';
import { Page, PageHeader } from '../../ui/PageHeader.tsx';
import { AskClient } from './AskClient.tsx';

export const dynamic = 'force-dynamic';

export default function AskPage() {
  return (
    <Page>
      <PageHeader
        title="Ask"
        subtitle="Questions about your money, answered from your own records"
      />
      <AskClient enabled={aiConfigured()} />
    </Page>
  );
}
