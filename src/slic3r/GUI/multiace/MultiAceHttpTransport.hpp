#ifndef slic3r_MultiAceHttpTransport_hpp_
#define slic3r_MultiAceHttpTransport_hpp_

#include "libslic3r/MultiAceTransport.hpp"
#include "slic3r/Utils/Http.hpp"

#include <cstddef>
#include <exception>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>

namespace Slic3r::MultiAce {

struct HttpTransportConfig
{
    std::string                        base_url;
    std::string                        username;
    std::string                        password;
    std::string                        bearer_token;
    std::map<std::string, std::string> headers;
    long                               connect_timeout_seconds = 5;
    long                               request_timeout_seconds = 15;
    std::size_t                        response_size_limit      = 2 * 1024 * 1024;
};

class HttpRestTransport final : public RestTransport
{
public:
    explicit HttpRestTransport(HttpTransportConfig config) : m_config(std::move(config))
    {
        while (!m_config.base_url.empty() && m_config.base_url.back() == '/')
            m_config.base_url.pop_back();

        if (m_config.base_url.rfind("http://", 0) != 0 && m_config.base_url.rfind("https://", 0) != 0)
            throw std::invalid_argument("multiACE base URL must start with http:// or https://");
        if (m_config.connect_timeout_seconds <= 0)
            throw std::invalid_argument("multiACE connect timeout must be positive");
        if (m_config.request_timeout_seconds <= 0)
            throw std::invalid_argument("multiACE request timeout must be positive");
        if (m_config.response_size_limit == 0)
            throw std::invalid_argument("multiACE response size limit must be positive");
    }

    TransportResponse get(const std::string& path) override { return perform_request(false, path, {}); }

    TransportResponse post(const std::string& path, const std::string& body) override { return perform_request(true, path, body); }

    const HttpTransportConfig& config() const { return m_config; }

private:
    TransportResponse perform_request(bool post_request, const std::string& path, const std::string& body)
    {
        const std::string url = build_url(path);

        auto execute = [this, post_request, &body](Http request) {
            TransportResponse response;

            request.timeout_connect(m_config.connect_timeout_seconds)
                .timeout_max(m_config.request_timeout_seconds)
                .size_limit(m_config.response_size_limit);

            if (!m_config.username.empty())
                request.auth_basic(m_config.username, m_config.password);
            if (!m_config.bearer_token.empty())
                request.header("Authorization", "Bearer " + m_config.bearer_token);
            for (const auto& header : m_config.headers)
                request.header(header.first, header.second);
            if (post_request) {
                request.header("Content-Type", "application/json");
                request.set_post_body(body);
            }

            request.on_complete([&response](std::string response_body, unsigned status_code) {
                response.body        = std::move(response_body);
                response.status_code = status_code;
            });
            request.on_error([&response](std::string response_body, std::string error, unsigned status_code) {
                response.body        = std::move(response_body);
                response.error       = std::move(error);
                response.status_code = status_code;
            });

            try {
                request.perform_sync();
            } catch (const std::exception& error) {
                response.error = error.what();
            } catch (...) {
                response.error = "unknown HTTP transport failure";
            }

            if (response.status_code == 0 && response.error.empty())
                response.error = "HTTP request completed without a status code";
            return response;
        };

        return post_request ? execute(Http::post(url)) : execute(Http::get(url));
    }

    std::string build_url(const std::string& path) const
    {
        if (path.empty())
            throw std::invalid_argument("multiACE request path must not be empty");
        if (path.rfind("http://", 0) == 0 || path.rfind("https://", 0) == 0)
            throw std::invalid_argument("multiACE request path must be relative to the configured base URL");
        return m_config.base_url + (path.front() == '/' ? path : '/' + path);
    }

    HttpTransportConfig m_config;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceHttpTransport_hpp_
