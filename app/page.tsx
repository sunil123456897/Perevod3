import { ToastProvider } from '@/components/ToastProvider';
import PipelineStudioApp from '@/components/PipelineStudioApp';

export default function HomePage() {
  return (
    <ToastProvider>
      <PipelineStudioApp />
    </ToastProvider>
  );
}
