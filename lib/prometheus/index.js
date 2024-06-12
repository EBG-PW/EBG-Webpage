const prometheusURL = `${process.env.PROMETHEUS_HTTP}://${process.env.PROMETHEUS_HOST}:${process.env.PROMETHEUS_PORT}/api/v1/query`;

const solar_query = 'opendtu_Power{channel="0", job="solar", type="AC", unit="0"}';
const shelly_em3_query = 'shelly_meter_power_current_watts{address="192.168.1.48", instance="shelly-exporter.default:8080", job="shelly", mac="08F9E0EB2B3C", name="Serverraum", type="SPEM-003CEBEU"}';

const fetchSolarData = async () => {
    try {
        const response = await fetch(`${prometheusURL}?query=${encodeURIComponent(solar_query)}`);
        if (!response.ok) {
            throw new Error(`Error fetching data: ${response.statusText}`);
        }
        
        const data = await response.json();
        const results = data.data.result;

        if (results.length === 0) {
            throw new Error('No data found');
        }

        let totalPower = 0;

        for (const result of results) {
            totalPower += parseFloat(result.value[1]);
        }

        return totalPower;
    } catch (error) {
        throw new Error(`Failed to fetch solar data: ${error.message}`);
    }
}

const fetchShellyMeterVData = async () => {
    try {
        const response = await fetch(`${prometheusURL}?query=${encodeURIComponent(shelly_em3_query)}`);
        if (!response.ok) {
            throw new Error(`Error fetching data: ${response.statusText}`);
        }
        
        const data = await response.json();
        const results = data.data.result;

        if (results.length === 0) {
            return 'No data found for the given query.';
        }

        let output = {
            power_a: 0,
            power_b: 0,
            power_c: 0,
        };
        
        results.forEach(result => {
            const channel = result.metric.channel;
            const latestValue = parseFloat(result.value[1]);

            if (channel === 'a') {
                output.power_a = latestValue;
            } else if (channel === 'b') {
                output.power_b = latestValue;
            } else if (channel === 'c') {
                output.power_c = latestValue;
            }
        });

        return output;
    } catch (error) {
        throw new Error(`Error: ${error.message}`);
    }
}


module.exports = {
    fetchSolarData,
    fetchShellyMeterVData,
};