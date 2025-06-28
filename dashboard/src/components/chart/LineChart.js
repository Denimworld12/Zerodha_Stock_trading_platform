import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap';
import { Chart } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  TreemapController,
  TreemapElement
);

const options = {
  responsive: true,
  maintainAspectRatio: false,
   animation: false,
  plugins: {
    legend: { display: false },
    title: { display: false }
  },
  treemap: {
    padding: 1,
    size: ['100%', '100%'],
    display: 'single'
  }
};

export function LineChart({ data }) {
  return (
    <div style={{ width: '100%', height: '80px' }}>
      <Chart type="treemap" data={data} options={options} />
    </div>
  );
}
