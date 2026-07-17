#ifndef slic3r_MultiAceHttpTransport_hpp_
#define slic3r_MultiAceHttpTransport_hpp_

#include "libslic3r/MultiAceTransport.hpp"

#include <cstddef>
#include <map>
#include <string>

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
    explicit HttpRestTransport(HttpTransportConfig config);

    TransportResponse get(const std::string& path) override;
    TransportResponse post(const std::string& path, const std::string& body) override;

    const HttpTransportConfig& config() const { return m_config; }

private:
    TransportResponse perform_request(bool post_request, const std::string& path, const std::string& body);
    std::string       build_url(const std::string& path) const;

    HttpTransportConfig m_config;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceHttpTransport_hpp_
