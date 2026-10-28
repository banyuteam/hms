import { useQuery } from '@tanstack/react-query';
import { patientApi } from './patientApi';

/** Query key carries the MRN in memory only — it is never persisted and never put in a URL. */
export function usePatient(mrn: string) {
  return useQuery({ queryKey: ['patient', mrn], queryFn: () => patientApi.getPatient(mrn) });
}
