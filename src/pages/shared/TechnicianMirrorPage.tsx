import { useParams, useNavigate } from 'react-router-dom';
import { PortalLayout } from '../../components/PortalLayout';
import { TechnicianMirrorModal } from '../../components/TechnicianMirrorModal';

// Espelho do técnico em página própria (somente leitura): o que o técnico vê no próprio portal.
export function TechnicianMirrorPage({ backRoute }: { backRoute: string }) {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <PortalLayout title="Espelho do técnico" breadcrumb="Equipa técnica">
      <TechnicianMirrorModal
        technicianId={id ?? null}
        mode="page"
        onClose={() => navigate(backRoute)}
      />
    </PortalLayout>
  );
}
