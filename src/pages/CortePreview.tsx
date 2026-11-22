/**
 * Auditoria DEV do corte que gera OS. Fora do bundle de produção.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CorteLaunchBody, CORTE_PREVIEW_CARD, CORTE_PREVIEW_PEOPLE } from '@/components/production/kanban/CorteCabedalQueue';
import { cutFollowDocument, cutFollowSection, qrMarkup } from '@/lib/printCutFollowSheet';
import { sizeGradeForCut } from '@/lib/corteCabedal';

function sheetInput(qr: string) {
  return cutFollowSection({
    order: {
      number: 'OS-204',
      contractorName: 'Ateliê Bia',
      phone: '21 99999-0002',
      address: 'Rua B, 20',
      city: 'Nilópolis',
      state: 'RJ',
      quantity: 100,
      grade: { P: 20, G: 80 },
      sizeGrade: sizeGradeForCut(CORTE_PREVIEW_CARD.ranges, { P: 20, G: 80 }, CORTE_PREVIEW_CARD.itemGrade),
      returnOn: '28/11/2026',
    },
    orderNumber: CORTE_PREVIEW_CARD.orderNumber,
    clientName: CORTE_PREVIEW_CARD.clientName,
    referenceCode: CORTE_PREVIEW_CARD.referenceCode,
    referenceName: CORTE_PREVIEW_CARD.referenceName,
    imageUrl: CORTE_PREVIEW_CARD.photoUrl,
    color: CORTE_PREVIEW_CARD.color,
    sectorLabel: CORTE_PREVIEW_CARD.sectorLabel,
    billingWeek: CORTE_PREVIEW_CARD.billingWeek,
    sizesByRange: { P: ['34', '35'], G: ['39', '40'] },
    sentOn: '22/11/2026',
    launchNumber: 2,
    partial: true,
  }, qr);
}

function FolhaPreview() {
  const [html, setHtml] = useState('');
  useEffect(() => {
    void qrMarkup('OS-204').then((qr) => setHtml(cutFollowDocument([sheetInput(qr)])));
  }, []);
  if (!html) return null;
  return <iframe id="corte-folha" title="Folha de acompanhamento" className="mx-auto block h-[1120px] w-[794px]" srcDoc={html} />;
}

export default function CortePreview() {
  const [params] = useSearchParams();
  const tela = params.get('tela') || '1';
  return (
    <div className="min-h-screen bg-background">
      {tela === '1' && <div id="corte-passo-1" className="mx-auto w-[390px] p-3">
        <CorteLaunchBody
          card={CORTE_PREVIEW_CARD}
          contractors={CORTE_PREVIEW_PEOPLE}
          previewApprove={() => []}
          startOpen
          ledgerLines={[
            { contractorId: 'a', sectorKey: 'costura', periodStart: '2026-11-16', streetPairs: 40, capacityPeriod: 200 },
            { contractorId: 'b', sectorKey: 'costura', periodStart: '2026-11-16', streetPairs: 80, capacityPeriod: 150 },
            { contractorId: 'c', sectorKey: 'costura', periodStart: '2026-11-16', streetPairs: 0, capacityPeriod: 100 },
          ]}
        />
      </div>}
      {tela === '2' && <div id="corte-passo-2" className="mx-auto w-[390px] p-3">
        <CorteLaunchBody
          card={CORTE_PREVIEW_CARD}
          contractors={CORTE_PREVIEW_PEOPLE}
          previewApprove={() => []}
          initialStep="fill"
          startOpen
        />
      </div>}
      {tela === 'folha' && <FolhaPreview />}
    </div>
  );
}
