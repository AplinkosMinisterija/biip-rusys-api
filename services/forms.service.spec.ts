jest.mock('../utils/mails', () => ({
  emailCanBeSent: () => false,
  notifyFormAssignee: jest.fn(),
  notifyOnFormUpdate: jest.fn(),
}));

// forms.service reaches taxonomies.species.service before requests.service, which leaves
// requests.service with an undefined enum; loading requests.service first unwinds the cycle.
import './requests.service';
import RequestsService from './requests.service';

import { FormStatus } from '../types';
import FormsService, { adminCanReturnApprovedForm, formsVisibleToUser } from './forms.service';
import { User, UserType } from './users.service';

type FormRow = {
  id: number;
  status: string;
  assigneeId: number | null;
  createdBy: number;
  speciesId: number;
};

type ValidateAssignee = (
  this: unknown,
  args: {
    ctx: { meta: { user?: Partial<User>; profile?: unknown } };
    value: number | null;
    entity: FormRow;
  },
) => Promise<true | string>;

type AssigneeList = { rows: Array<{ id: number }>; total: number };

type ListAssignees = (
  this: unknown,
  ctx: {
    params: { id: number };
    meta: { user?: Partial<User>; profile?: unknown };
    call: (action: string, params?: unknown) => Promise<unknown>;
  },
) => Promise<AssigneeList>;

const { validateAssignee, listAssignees, expertCanReassign, isSpeciesExpert } =
  FormsService.prototype as unknown as {
    validateAssignee: ValidateAssignee;
    listAssignees: ListAssignees;
    expertCanReassign: unknown;
    isSpeciesExpert: unknown;
  };

const SPECIES = 7;
const AUTHOR = 1;
const HOLDER = 2;
const OTHER_EXPERT = 3;
const NOT_AN_EXPERT = 4;
const OTHER_SPECIES_EXPERT = 5;

const speciesByExpert: Record<number, number[]> = {
  [AUTHOR]: [SPECIES],
  [HOLDER]: [SPECIES],
  [OTHER_EXPERT]: [SPECIES],
  [NOT_AN_EXPERT]: [],
  [OTHER_SPECIES_EXPERT]: [SPECIES + 1],
};

const serviceSelf = () => ({
  expertCanReassign,
  isSpeciesExpert,
  broker: {
    call: async (action: string, params: { userId: number }) => {
      if (action === 'requests.getExpertSpecies') return speciesByExpert[params.userId] ?? [];
      throw new Error(`unexpected call: ${action}`);
    },
  },
});

const expert = (id: number): Partial<User> => ({
  id,
  type: UserType.USER,
  isExpert: true,
  expertSpecies: [SPECIES],
});

const admin: Partial<User> = { id: 99, type: UserType.ADMIN, isExpert: false, expertSpecies: [] };

const form = (overrides: Partial<FormRow> = {}): FormRow => ({
  id: 10,
  status: FormStatus.SUBMITTED,
  assigneeId: HOLDER,
  createdBy: AUTHOR,
  speciesId: SPECIES,
  ...overrides,
});

describe('automatic assignment excludes manual-only request coverage', () => {
  const requests = [
    { createdBy: HOLDER, inheritedSpecies: [SPECIES], data: { autoAssignDisabled: true } },
    { createdBy: OTHER_EXPERT, inheritedSpecies: [SPECIES], data: {} },
  ];
  const expertLookup = (params: unknown, rows = requests) =>
    (RequestsService.prototype as any).getExpertsIdsBySpecies.call(
      {},
      {
        params,
        call: jest.fn().mockResolvedValue(rows),
      },
    );

  it('automatically selects the unmarked expert even when the commission has fewer tasks', async () => {
    const result = await (FormsService.prototype as any).getAssigneeForForm.call(
      {},
      {
        params: { species: SPECIES, createdBy: AUTHOR },
        call: async (action: string, params: any) => {
          if (action === 'requests.getExpertsIdsBySpecies') return expertLookup(params);
          if (action === 'forms.getTasksCount') return params.userId === HOLDER ? 0 : 10;
          throw new Error(`unexpected call: ${action}`);
        },
      },
    );
    expect(result).toBe(OTHER_EXPERT);
  });

  it('leaves the form unassigned when only the commission covers the species', async () => {
    const result = await (FormsService.prototype as any).getAssigneeForForm.call(
      {},
      {
        params: { species: SPECIES },
        call: async (action: string, params: any) => {
          if (action === 'requests.getExpertsIdsBySpecies')
            return expertLookup(params, [requests[0]]);
          if (action === 'forms.getTasksCount') return 0;
          throw new Error(`unexpected call: ${action}`);
        },
      },
    );
    expect(result).toBeUndefined();
  });

  it('still offers the commission in the administrator manual assignee list', async () => {
    const result: AssigneeList = await listAssignees.call(serviceSelf(), {
      params: { id: 10 },
      meta: { user: admin },
      call: async (action: string, params: any) => {
        if (action === 'forms.resolve') return { ...form(), species: SPECIES, assignee: HOLDER };
        if (action === 'requests.getExpertsIdsBySpecies') return expertLookup(params);
        if (action === 'users.resolve') return params.id.map((id: number) => ({ id }));
        throw new Error(`unexpected call: ${action}`);
      },
    });
    expect(result.rows.map((row) => row.id)).toContain(HOLDER);
  });

  it('can still pick an expert through their other unmarked request', async () => {
    const rows = [requests[0], { ...requests[1], createdBy: HOLDER }];
    const result = await (FormsService.prototype as any).getAssigneeForForm.call(
      {},
      {
        params: { species: SPECIES },
        call: async (action: string, params: any) => {
          if (action === 'requests.getExpertsIdsBySpecies') return expertLookup(params, rows);
          if (action === 'forms.getTasksCount') return 0;
          throw new Error(`unexpected call: ${action}`);
        },
      },
    );
    expect(result).toBe(HOLDER);
  });

  it('keeps the manually assigned commission when changing to another covered species', async () => {
    const updateById = jest.fn();
    const original = { ...form(), assignee: HOLDER, species: SPECIES };
    await (FormsService.prototype as any).setSpecies.call(
      {
        resolveEntities: async () => original,
        getAdapter: async () => ({ updateById }),
        _entityChanged: jest.fn(),
        createFormHistory: jest.fn(),
      },
      {
        params: { id: 10, species: SPECIES + 1 },
        meta: { user: admin },
        call: async (action: string, params: any) => {
          if (action === 'taxonomies.findBySpeciesId') return { [SPECIES + 1]: {} };
          if (action === 'requests.getExpertsIdsBySpecies') {
            return expertLookup(params, [{ ...requests[0], inheritedSpecies: [SPECIES + 1] }]);
          }
          throw new Error(`unexpected call: ${action}`);
        },
      },
    );
    expect(updateById).toHaveBeenCalledWith(10, expect.objectContaining({ assigneeId: HOLDER }));
  });

  it.each([FormStatus.APPROVED, FormStatus.RETURNED, FormStatus.REJECTED])(
    'allows the assigned commission to decide %s',
    (status) => {
      const prototype = FormsService.prototype as any;
      expect(
        prototype.validateStatus.call(
          { hasPermissionToEdit: prototype.hasPermissionToEdit },
          {
            ctx: { meta: { user: expert(HOLDER) } },
            value: status,
            entity: { ...form(), tenantId: null },
          },
        ),
      ).toBe(true);
    },
  );
});

const assign = (
  user: Partial<User>,
  value: number | null,
  entity: FormRow,
  params: { status?: string } = {},
) => validateAssignee.call(serviceSelf(), { ctx: { meta: { user } }, value, params, entity });

describe('validateAssignee — an expert handing the form to another expert', () => {
  it.each([FormStatus.CREATED, FormStatus.SUBMITTED])(
    'lets the holder of a %s form pick another expert of the species',
    async (status) => {
      await expect(assign(expert(HOLDER), OTHER_EXPERT, form({ status }))).resolves.toBe(true);
    },
  );

  it('refuses a target who is an expert, but of another species', async () => {
    await expect(assign(expert(HOLDER), OTHER_SPECIES_EXPERT, form())).resolves.toBe(
      'Assignee cannot be set.',
    );
  });

  it.each([FormStatus.RETURNED, FormStatus.REJECTED, FormStatus.APPROVED])(
    'refuses a handover that closes the form to %s in the same update',
    async (status) => {
      await expect(assign(expert(HOLDER), OTHER_EXPERT, form(), { status })).resolves.toBe(
        'Cannot assign to somebody else.',
      );
    },
  );

  it.each([FormStatus.RETURNED, FormStatus.REJECTED, FormStatus.APPROVED])(
    'refuses a %s form',
    async (status) => {
      await expect(assign(expert(HOLDER), OTHER_EXPERT, form({ status }))).resolves.toBe(
        'Cannot assign to somebody else.',
      );
    },
  );

  it('refuses an expert who does not hold the form', async () => {
    await expect(
      assign(expert(HOLDER), OTHER_EXPERT, form({ assigneeId: OTHER_EXPERT })),
    ).resolves.toBe('Cannot assign to somebody else.');
  });

  it('refuses a target who is not an expert of this species', async () => {
    await expect(assign(expert(HOLDER), NOT_AN_EXPERT, form())).resolves.toBe(
      'Assignee cannot be set.',
    );
  });

  it('refuses the author of the form', async () => {
    await expect(assign(expert(HOLDER), AUTHOR, form())).resolves.toBe('Cannot assign to creator.');
  });
});

describe('validateAssignee — the rules that were already there', () => {
  it('lets an expert take an unassigned form', async () => {
    await expect(assign(expert(HOLDER), HOLDER, form({ assigneeId: null }))).resolves.toBe(true);
  });

  it('refuses an expert taking a form somebody else holds', async () => {
    await expect(assign(expert(HOLDER), HOLDER, form({ assigneeId: OTHER_EXPERT }))).resolves.toBe(
      'Assignee already exists.',
    );
  });

  it('refuses an expert unassigning somebody else', async () => {
    await expect(assign(expert(HOLDER), null, form({ assigneeId: OTHER_EXPERT }))).resolves.toBe(
      'Cannot unassign others.',
    );
  });

  it('lets an admin assign any expert of the species', async () => {
    await expect(assign(admin, OTHER_EXPERT, form({ assigneeId: null }))).resolves.toBe(true);
  });

  it('refuses an admin assigning somebody who is not an expert of the species', async () => {
    await expect(assign(admin, NOT_AN_EXPERT, form({ assigneeId: null }))).resolves.toBe(
      'Assignee cannot be set.',
    );
  });
});

describe('listAssignees', () => {
  const listFor = async (user: Partial<User>, status: string, assignee: number | null) => {
    const call = async (action: string, params?: unknown) => {
      if (action === 'forms.resolve') {
        return { id: 10, status, assignee, createdBy: AUTHOR, species: SPECIES };
      }
      if (action === 'requests.getExpertsIdsBySpecies') return [AUTHOR, HOLDER, OTHER_EXPERT];
      if (action === 'users.resolve') return (params as { id: number[] }).id.map((id) => ({ id }));
      throw new Error(`unexpected call: ${action}`);
    };

    const list: AssigneeList = await listAssignees.call(serviceSelf(), {
      params: { id: 10 },
      meta: { user },
      call,
    });

    return { ids: list.rows.map((u) => u.id).sort((a, b) => a - b), total: list.total };
  };

  it('offers the holder every expert of the species except the author', async () => {
    await expect(listFor(expert(HOLDER), FormStatus.SUBMITTED, HOLDER)).resolves.toEqual({
      ids: [HOLDER, OTHER_EXPERT],
      total: 2,
    });
  });

  it('offers an expert who does not hold the form only himself', async () => {
    await expect(listFor(expert(HOLDER), FormStatus.SUBMITTED, null)).resolves.toEqual({
      ids: [HOLDER],
      total: 1,
    });
  });

  it('offers the holder of a returned form only himself', async () => {
    await expect(listFor(expert(HOLDER), FormStatus.RETURNED, HOLDER)).resolves.toEqual({
      ids: [HOLDER],
      total: 1,
    });
  });

  it('offers an admin every expert of the species except the author', async () => {
    await expect(listFor(admin, FormStatus.SUBMITTED, HOLDER)).resolves.toEqual({
      ids: [HOLDER, OTHER_EXPERT],
      total: 2,
    });
  });
});

describe('formsVisibleToUser — a person sees the forms they filed, whichever profile they used', () => {
  const person: Partial<User> = {
    id: AUTHOR,
    type: UserType.USER,
    isExpert: false,
    expertSpecies: [],
  };
  const tenant = { id: 42 };

  const visible = (
    query: Record<string, unknown>,
    meta: { user?: Partial<User>; profile?: { id: number } },
  ) => formsVisibleToUser(query, meta as never, {});

  it('keeps every own form when a tenant profile is active', () => {
    expect(visible({ createdBy: AUTHOR }, { user: person, profile: tenant })).toEqual({
      createdBy: AUTHOR,
    });
  });

  it('keeps every own form when no profile is active', () => {
    expect(visible({ createdBy: AUTHOR }, { user: person })).toEqual({ createdBy: AUTHOR });
  });

  it('keeps every own form of an expert', () => {
    expect(visible({ createdBy: HOLDER }, { user: expert(HOLDER) })).toEqual({
      createdBy: HOLDER,
    });
  });

  it('still narrows a plain listing to the active tenant', () => {
    expect(visible({}, { user: person, profile: tenant })).toEqual({ tenant: tenant.id });
  });

  it('still narrows a plain listing of a profile-less person to their own forms', () => {
    expect(visible({}, { user: person })).toEqual({
      createdBy: AUTHOR,
      tenant: { $exists: false },
    });
  });

  it('refuses to list somebody else by createdBy', () => {
    expect(visible({ createdBy: OTHER_EXPERT }, { user: person })).toEqual({
      createdBy: AUTHOR,
      tenant: { $exists: false },
    });
  });
});

describe('adminCanReturnApprovedForm — reopening a checked form', () => {
  const approved = { status: FormStatus.APPROVED };

  it('lets an admin send an approved form back to its author', () => {
    expect(adminCanReturnApprovedForm(admin, approved, FormStatus.RETURNED)).toBe(true);
  });

  it.each([FormStatus.REJECTED, FormStatus.SUBMITTED, FormStatus.CREATED])(
    'refuses an admin setting %s instead',
    (status) => {
      expect(adminCanReturnApprovedForm(admin, approved, status)).toBe(false);
    },
  );

  it.each([FormStatus.SUBMITTED, FormStatus.RETURNED, FormStatus.REJECTED])(
    'leaves a %s form to the usual rules',
    (status) => {
      expect(adminCanReturnApprovedForm(admin, { status }, FormStatus.RETURNED)).toBe(false);
    },
  );

  it('refuses an expert', () => {
    expect(adminCanReturnApprovedForm(expert(HOLDER), approved, FormStatus.RETURNED)).toBe(false);
  });

  it('refuses an anonymous caller', () => {
    expect(adminCanReturnApprovedForm(undefined, approved, FormStatus.RETURNED)).toBe(false);
  });
});

describe('validateStatus — who may change an approved form', () => {
  const { validateStatus, hasPermissionToEdit } = FormsService.prototype as unknown as {
    validateStatus: (
      this: unknown,
      args: {
        ctx: { meta: { user?: Partial<User>; profile?: unknown } };
        value: string;
        entity: { id: number; status: string; createdBy: number };
      },
    ) => true | string;
    hasPermissionToEdit: unknown;
  };

  const approvedForm = { id: 10, status: FormStatus.APPROVED, createdBy: AUTHOR };

  const check = (user: Partial<User>, value: string) =>
    validateStatus.call(
      { hasPermissionToEdit },
      { ctx: { meta: { user } }, value, entity: approvedForm },
    );

  it('lets an admin return an approved form', () => {
    expect(check(admin, FormStatus.RETURNED)).toBe(true);
  });

  it('still refuses an admin rejecting an approved form', () => {
    expect(check(admin, FormStatus.REJECTED)).toBe(
      `Cannot set status with value ${FormStatus.REJECTED}`,
    );
  });

  it('still refuses an expert returning an approved form', () => {
    expect(check(expert(HOLDER), FormStatus.RETURNED)).toBe(
      `Cannot set status with value ${FormStatus.RETURNED}`,
    );
  });
});

describe('hasPermissionToEdit — the author fixing a form before it is checked', () => {
  const { hasPermissionToEdit } = FormsService.prototype as unknown as {
    hasPermissionToEdit: (
      form: { id: number; status: string; createdBy: number; tenantId: null },
      user: Partial<User>,
    ) => { edit: boolean; validate: boolean };
  };

  const author: Partial<User> = { id: AUTHOR, type: UserType.USER, isExpert: false };
  const canEdit = (status: string) =>
    hasPermissionToEdit({ id: 10, status, createdBy: AUTHOR, tenantId: null }, author).edit;

  it('lets the author edit a freshly submitted form', () => {
    expect(canEdit(FormStatus.CREATED)).toBe(true);
  });

  it('lets the author edit a resubmitted or returned form', () => {
    expect(canEdit(FormStatus.SUBMITTED)).toBe(true);
    expect(canEdit(FormStatus.RETURNED)).toBe(true);
  });

  it('refuses the author once the form is approved or rejected', () => {
    expect(canEdit(FormStatus.APPROVED)).toBe(false);
    expect(canEdit(FormStatus.REJECTED)).toBe(false);
  });

  it('refuses somebody else', () => {
    expect(
      hasPermissionToEdit(
        { id: 10, status: FormStatus.CREATED, createdBy: AUTHOR, tenantId: null },
        { id: 77 },
      ).edit,
    ).toBe(false);
  });
});

describe('import — imported forms follow the usual review rules', () => {
  const { import: importForms } = FormsService.prototype as unknown as {
    import: (this: unknown, ctx: unknown) => Promise<{ created: number }>;
  };

  const row = {
    species: SPECIES,
    quantity: 2,
    observedAt: '2026-10-24T15:15:00.000Z',
    observedBy: 'Vardenis Pavardenis',
    x: 306945.2,
    y: 6134367.25,
    description: 'Stebėti du suaugę paukščiai',
    source: 9,
  };

  it('does not approve the forms itself, whatever an earlier row left in the meta', async () => {
    const createMetas: Array<Record<string, unknown>> = [];
    const ctx = {
      params: { rows: [row, row], dryRun: false },
      meta: { user: { id: 1, type: UserType.ADMIN } } as Record<string, unknown>,
      call: jest.fn(async (action: string, _params?: unknown, opts?: { meta?: object }) => {
        if (action === 'taxonomies.findBySpeciesId') {
          return { [SPECIES]: { speciesId: SPECIES, speciesType: 'ENDANGERED' } };
        }
        if (action === 'forms.settings.sources.find') return [{ id: 9 }];
        if (action === 'forms.criteria.bySpecies') return { signs: [], stages: [] };
        if (action === 'forms.create') {
          createMetas.push({ ...opts?.meta });
          ctx.meta.autoApprove = true;
          return { id: createMetas.length };
        }
      }),
    };

    const result = await importForms.call(
      {
        geomIsInLithuania: async () => true,
        refreshMaterializedView: jest.fn(),
        logger: { warn: jest.fn() },
      },
      ctx,
    );

    expect(result.created).toBe(2);
    expect(createMetas.map((meta) => meta.autoApprove)).toEqual([false, false]);
  });
});

describe('setSpecies — the assigned expert corrects the species while checking', () => {
  const { setSpecies } = FormsService.prototype as unknown as {
    setSpecies: (this: unknown, ctx: unknown) => Promise<unknown>;
  };

  const run = (status: string) => {
    const form = { id: 10, status, species: SPECIES, assignee: HOLDER, createdBy: AUTHOR };
    const updateById = jest.fn();
    const ctx = {
      params: { id: form.id, species: SPECIES + 1 },
      meta: { user: { id: HOLDER, type: UserType.USER, isExpert: true } },
      call: jest.fn(async (action: string) => {
        if (action === 'taxonomies.findBySpeciesId') {
          return { [SPECIES]: { speciesName: 'A' }, [SPECIES + 1]: { speciesName: 'B' } };
        }
        if (action === 'requests.getExpertsIdsBySpecies') return [HOLDER];
      }),
    };
    const service = {
      resolveEntities: async () => form,
      getAdapter: async () => ({ updateById }),
      _entityChanged: jest.fn(),
      createFormHistory: jest.fn(),
    };
    return { promise: setSpecies.call(service, ctx), updateById };
  };

  it('works on a form submitted for the first time', async () => {
    const { promise, updateById } = run(FormStatus.CREATED);
    await promise;
    expect(updateById).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ speciesId: SPECIES + 1 }),
    );
  });

  it('is refused once the form is approved', async () => {
    const { promise, updateById } = run(FormStatus.APPROVED);
    await expect(promise).rejects.toThrow();
    expect(updateById).not.toHaveBeenCalled();
  });
});
