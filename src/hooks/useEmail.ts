import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/apiClient';

export const EMAIL_TEMPLATE_KEYS = {
  list: ['emailTemplates'] as const,
  single: (id: string) => ['emailTemplates', id] as const,
};

export interface EmailTemplate {
  id: string;
  name: string;
  type: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  variables: string | string[];
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function useEmailTemplates(type?: string) {
  return useQuery({
    queryKey: [...EMAIL_TEMPLATE_KEYS.list, { type }],
    queryFn: () =>
      api.get<{ data: EmailTemplate[]; total: number }>('/api/v1/email-templates', type ? { type } : {}),
    staleTime: 30_000,
  });
}

export function useEmailTemplate(id: string | undefined) {
  return useQuery({
    queryKey: EMAIL_TEMPLATE_KEYS.single(id ?? ''),
    queryFn: () => api.get<EmailTemplate>(`/api/v1/email-templates/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<EmailTemplate> | { seedDefaults: true }) =>
      api.post('/api/v1/email-templates', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: EMAIL_TEMPLATE_KEYS.list }),
  });
}

export function useUpdateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...updates }: Partial<EmailTemplate> & { id: string }) =>
      api.put(`/api/v1/email-templates/${id}`, updates),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: EMAIL_TEMPLATE_KEYS.list });
      qc.invalidateQueries({ queryKey: EMAIL_TEMPLATE_KEYS.single(vars.id) });
    },
  });
}

export function useDeleteEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/email-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: EMAIL_TEMPLATE_KEYS.list }),
  });
}
