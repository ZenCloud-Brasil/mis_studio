/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import fetchMock from 'fetch-mock';
import { Link } from 'react-router-dom';
import {
  render,
  waitFor,
  screen,
  fireEvent,
} from 'spec/helpers/testing-library';
import { getExploreFormData } from 'spec/fixtures/mockExploreFormData';
import { getDashboardFormData } from 'spec/fixtures/mockDashboardFormData';
import { LocalStorageKeys } from 'src/utils/localStorageHelpers';
import getFormDataWithExtraFilters from 'src/dashboard/util/charts/getFormDataWithExtraFilters';
import { URL_PARAMS } from 'src/constants';
import { JsonObject, VizType } from '@superset-ui/core';
import { useUnsavedChangesPrompt } from 'src/hooks/useUnsavedChangesPrompt';
import { getParsedExploreURLParams } from 'src/explore/exploreUtils/getParsedExploreURLParams';
import ChartPage from '.';

jest.mock('src/hooks/useUnsavedChangesPrompt', () => ({
  useUnsavedChangesPrompt: jest.fn(),
}));
jest.mock('re-resizable', () => ({
  Resizable: () => <div data-test="mock-re-resizable" />,
}));
jest.mock(
  'src/explore/components/ExploreChartPanel',
  () =>
    ({ exploreState }: { exploreState: JsonObject }) => (
      <div data-test="mock-explore-chart-panel">
        {JSON.stringify(exploreState)}
      </div>
    ),
);
jest.mock('src/dashboard/util/charts/getFormDataWithExtraFilters');
jest.mock('src/explore/exploreUtils/getParsedExploreURLParams', () => ({
  getParsedExploreURLParams: jest.fn(),
}));

describe('ChartPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (useUnsavedChangesPrompt as jest.Mock).mockReturnValue({
      showModal: false,
      setShowModal: jest.fn(),
      handleConfirmNavigation: jest.fn(),
      handleSaveAndCloseModal: jest.fn(),
    });
  });

  afterEach(() => {
    fetchMock.reset();
  });

  test('fetches metadata on mount', async () => {
    const exploreApiRoute = 'glob:*/api/v1/explore/*';
    const exploreFormData = getExploreFormData({
      viz_type: VizType.Table,
      show_cell_bars: true,
    });
    fetchMock.get(exploreApiRoute, {
      result: { dataset: { id: 1 }, form_data: exploreFormData },
    });
    const { getByTestId } = render(<ChartPage />, {
      useRouter: true,
      useRedux: true,
      useDnd: true,
    });
    await waitFor(() =>
      expect(fetchMock.calls(exploreApiRoute).length).toBe(1),
    );
    expect(getByTestId('mock-explore-chart-panel')).toBeInTheDocument();
    expect(getByTestId('mock-explore-chart-panel')).toHaveTextContent(
      JSON.stringify({ show_cell_bars: true }).slice(1, -1),
    );
  });

  test('displays the dataset name and error when it is prohibited', async () => {
    const chartApiRoute = `glob:*/api/v1/chart/*`;
    const exploreApiRoute = 'glob:*/api/v1/explore/*';
    const expectedDatasourceName = 'failed datasource name';
    (getParsedExploreURLParams as jest.Mock).mockReturnValue(
      new Map([['datasource_id', 1]]),
    );
    fetchMock.get(exploreApiRoute, () => {
      class Extra {
        datasource = 123;

        datasource_name = expectedDatasourceName;
      }
      class SupersetSecurityError {
        message = 'You do not have a permission to the table';

        extra = new Extra();
      }
      throw new SupersetSecurityError();
    });
    fetchMock.get(chartApiRoute, 200);
    const { getByTestId } = render(<ChartPage />, {
      useRouter: true,
      useRedux: true,
      useDnd: true,
    });
    await waitFor(
      () =>
        expect(getByTestId('mock-explore-chart-panel')).toHaveTextContent(
          JSON.stringify({ datasource_name: expectedDatasourceName }).slice(
            1,
            -1,
          ),
        ),
      {
        timeout: 5000,
      },
    );
    expect(fetchMock.calls(chartApiRoute).length).toEqual(0);
    expect(fetchMock.calls(exploreApiRoute).length).toBeGreaterThanOrEqual(1);
  });

  test('fetches the chart api when explore metadata is prohibited and access from the chart link', async () => {
    const expectedChartId = 7;
    const expectedChartName = 'Unauthorized dataset owned chart name';
    (getParsedExploreURLParams as jest.Mock).mockReturnValue(
      new Map([['slice_id', expectedChartId]]),
    );
    const chartApiRoute = `glob:*/api/v1/chart/${expectedChartId}`;
    const exploreApiRoute = 'glob:*/api/v1/explore/*';

    fetchMock.get(exploreApiRoute, () => {
      class Extra {
        datasource = 123;
      }
      class SupersetSecurityError {
        message = 'You do not have a permission to the table';

        extra = new Extra();
      }
      throw new SupersetSecurityError();
    });
    fetchMock.get(chartApiRoute, {
      result: {
        id: expectedChartId,
        slice_name: expectedChartName,
        url: 'chartid',
      },
    });
    const { getByTestId, getByText } = render(<ChartPage />, {
      useRouter: true,
      useRedux: true,
      useDnd: true,
    });
    await waitFor(() => expect(fetchMock.calls(chartApiRoute).length).toBe(1), {
      timeout: 5000,
    });
    expect(fetchMock.calls(exploreApiRoute).length).toBeGreaterThanOrEqual(1);
    expect(getByTestId('mock-explore-chart-panel')).toBeInTheDocument();
    expect(getByTestId('mock-explore-chart-panel')).toHaveTextContent(
      JSON.stringify({ datasource: 123 }).slice(1, -1),
    );
    expect(getByText(expectedChartName)).toBeInTheDocument();
  });

  describe('with dashboardContextFormData', () => {
    const dashboardPageId = 'mockPageId';

    beforeEach(() => {
      localStorage.setItem(
        LocalStorageKeys.DashboardExploreContext,
        JSON.stringify({
          [dashboardPageId]: {},
        }),
      );
    });

    afterEach(() => {
      localStorage.clear();
      (getFormDataWithExtraFilters as jest.Mock).mockClear();
    });

    test('overrides the form_data with dashboardContextFormData', async () => {
      const dashboardFormData = getDashboardFormData();
      (getFormDataWithExtraFilters as jest.Mock).mockReturnValue(
        dashboardFormData,
      );
      const exploreApiRoute = 'glob:*/api/v1/explore/*';
      const exploreFormData = getExploreFormData();
      fetchMock.get(exploreApiRoute, {
        result: { dataset: { id: 1 }, form_data: exploreFormData },
      });
      window.history.pushState(
        {},
        '',
        `/?${URL_PARAMS.dashboardPageId.name}=${dashboardPageId}`,
      );
      const { getByTestId } = render(<ChartPage />, {
        useRouter: true,
        useRedux: true,
        useDnd: true,
      });
      await waitFor(() =>
        expect(fetchMock.calls(exploreApiRoute).length).toBe(1),
      );
      expect(getByTestId('mock-explore-chart-panel')).toHaveTextContent(
        JSON.stringify({ color_scheme: dashboardFormData.color_scheme }).slice(
          1,
          -1,
        ),
      );
    });

    test('overrides the form_data with exploreFormData when location is updated', async () => {
      const dashboardFormData = {
        ...getDashboardFormData(),
        viz_type: VizType.Table,
        show_cell_bars: true,
      };
      (getFormDataWithExtraFilters as jest.Mock).mockReturnValue(
        dashboardFormData,
      );
      const exploreApiRoute = 'glob:*/api/v1/explore/*';
      const exploreFormData = getExploreFormData({
        viz_type: VizType.Table,
        show_cell_bars: true,
      });
      fetchMock.get(exploreApiRoute, {
        result: { dataset: { id: 1 }, form_data: exploreFormData },
      });
      window.history.pushState(
        {},
        '',
        `/?${URL_PARAMS.dashboardPageId.name}=${dashboardPageId}`,
      );
      const { getByTestId } = render(
        <>
          <Link
            to={`/?${URL_PARAMS.dashboardPageId.name}=${dashboardPageId}&${URL_PARAMS.saveAction.name}=overwrite`}
          >
            Change route
          </Link>
          <ChartPage />
        </>,
        {
          useRouter: true,
          useRedux: true,
          useDnd: true,
        },
      );
      await waitFor(() =>
        expect(fetchMock.calls(exploreApiRoute).length).toBe(1),
      );
      expect(getByTestId('mock-explore-chart-panel')).toHaveTextContent(
        JSON.stringify({
          show_cell_bars: dashboardFormData.show_cell_bars,
        }).slice(1, -1),
      );
      const updatedExploreFormData = {
        ...exploreFormData,
        show_cell_bars: false,
      };
      fetchMock.reset();
      fetchMock.get(exploreApiRoute, {
        result: { dataset: { id: 1 }, form_data: updatedExploreFormData },
      });
      fireEvent.click(screen.getByText('Change route'));
      await waitFor(() =>
        expect(fetchMock.calls(exploreApiRoute).length).toBe(1),
      );
      expect(getByTestId('mock-explore-chart-panel')).toHaveTextContent(
        JSON.stringify({
          show_cell_bars: updatedExploreFormData.show_cell_bars,
        }).slice(1, -1),
      );
    });
  });
});
